// memory.ts — three different things, kept separate ON PURPOSE:
//   HISTORY = everything that happened      -> the durable event log (Part 2)
//   STATE   = a running SUMMARY of old work -> compacted working memory
//   CONTEXT = what the model sees THIS turn -> assembled fresh, on demand
// Compact by TOKEN BUDGET, not turn count: modern models batch many tool calls
// into one turn, so "turns" is a bad proxy for size. (Thresholds deliberately
// tiny so compaction fires on a short demo task; production sets them near the
// model's real context budget.)
import OpenAI from "openai";                // summarize() calls the model itself
type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Turn = Msg[];
const client = new OpenAI();
const MODEL = "gpt-4o-mini";
export const MAX_CONTEXT_TOKENS = 500;
export const KEEP_CONTEXT_TOKENS = 200;
export function estimateTokens(messages: Msg[]): number { // ~4 chars per token is plenty
  const chars = messages.reduce((n, m) =>
    n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m).length), 0);
  return Math.ceil(chars / 4);
}
export function buildContext(systemPrompt: string, task: string,
                             summary: string, turns: Turn[]): Msg[] {
  const context: Msg[] = [{ role: "system", content: systemPrompt },
                          { role: "user", content: task }];  // the GOAL is pinned —
  if (summary) {                                             // never summarized away
    context.push({ role: "system",
                   content: `Summary of earlier work so far:\n${summary}` });
  }
  for (const turn of turns) context.push(...turn);           // recent turns, verbatim
  return context;
}
export async function summarize(oldTurns: Turn[], priorSummary: string): Promise<string | null> {
  const transcript = oldTurns.flat().map((m) =>
    `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m)}`)
    .join("\n").slice(0, 6000);
  const r = await client.chat.completions.create({ model: MODEL, messages: [
    { role: "system", content:
      "You compress an agent's work log into a short running summary. " +
      "Preserve concrete facts: item ids, categories, draft ids, amounts, " +
      "and what was already sent. Be terse." },
    { role: "user", content: `Prior summary:\n${priorSummary || "(none)"}` +
      `\n\nFold in this newer work:\n${transcript}\n\nReturn the updated summary.` },
  ]});
  return r.choices[0].message.content;
}
