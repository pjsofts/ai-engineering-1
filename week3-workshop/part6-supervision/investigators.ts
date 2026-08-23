// investigators.ts — sub-agents are read-only INVESTIGATORS: tiny bounded
// agent loops over read tools, each in its OWN context. Read-only means a
// replay after a crash is harmless, so a whole investigation can be one
// durable step. The CHAOS_FAIL hook makes the failure demo reproducible.
import OpenAI from "openai";
import { CHARGES, searchKB } from "./tools.js";
type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Tool = OpenAI.Chat.Completions.ChatCompletionTool;
const client = new OpenAI();
const MODEL = "gpt-4o-mini";
const READ_TOOLS: Tool[] = [
  { type: "function", function: { name: "getCharges",
    description: "Look up a customer's charges.",
    parameters: { type: "object",
      properties: { customer_id: { type: "string" } },
      required: ["customer_id"] } } },
  { type: "function", function: { name: "searchKnowledgeBase",
    description: "Search the support knowledge base.",
    parameters: { type: "object",
      properties: { query: { type: "string" } }, required: ["query"] } } },
];
const INVESTIGATORS: Record<string, string> = {
  billing: "You are a billing investigator. Use getCharges to find " +
           "duplicate or erroneous charges. Report charge ids, the amount, " +
           "and the refund you'd recommend - concisely.",
  technical: "You are a technical investigator. Use searchKnowledgeBase " +
             "to find known bugs and workarounds. Report the issue, any " +
             "ticket, and the workaround - concisely.",
  sales: "You are a sales investigator. Use searchKnowledgeBase for " +
         "pricing guidance, then state the numbers and next step - concisely.",
};
const runReadTool = (name: string, args: any): string =>
  name === "getCharges"
    ? JSON.stringify(CHARGES[args.customer_id] ?? [])
    : JSON.stringify(searchKB(args.query));
export async function runInvestigator(agent: string, objective: string): Promise<string> {
  if (process.env.CHAOS_FAIL === agent) {          // make failure reproducible:
    throw new Error(`investigator '${agent}' crashed (CHAOS_FAIL)`);
  }
  const messages: Msg[] = [{ role: "system", content: INVESTIGATORS[agent] },
                           { role: "user", content: objective }];
  for (let i = 0; i < 5; i++) {                    // one bounded interaction
    const r = await client.chat.completions.create({ model: MODEL, messages,
                                                     tools: READ_TOOLS });
    const m = r.choices[0].message;
    messages.push(m);
    if (!m.tool_calls?.length) return m.content ?? "";
    for (const call of m.tool_calls) {
      messages.push({ role: "tool", tool_call_id: call.id,
        content: runReadTool(call.function.name,
                             JSON.parse(call.function.arguments)) });
    }
  }
  return "(investigator ran out of steps)";
}
