// model.ts — the model call, Part 1 style: ask, wait, get the whole answer.
// This is the Week 1 call, unchanged. The interface is what changes this week.
import OpenAI from "openai";

export type Msg = OpenAI.Chat.ChatCompletionMessageParam;

export const MODEL = process.env.MODEL ?? "gpt-4o-mini";

export const SYSTEM_PROMPT =
  "You are mycode, a terminal coding assistant. Be concise and concrete. " +
  "Prefer short paragraphs and small code blocks over long essays.";

const client = new OpenAI();

/** One turn. Returns the complete assistant message — only when it is done. */
export async function completeTurn(messages: Msg[]): Promise<string> {
  const res = await client.chat.completions.create({
    model: MODEL,
    messages,
  });
  return res.choices[0]?.message?.content ?? "";
}
