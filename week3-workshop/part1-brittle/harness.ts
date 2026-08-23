// harness.ts — Part 1: THE BRITTLE AGENT. Structurally it's Week 1's loop
// wearing a harness jacket: every move becomes an event. But look at the state:
// a plain in-memory array. Kill the process and it's gone — mid-task, mid-spend,
// mid-sendReply. Hold that thought for Part 2.
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { emit } from "./events.js";
import { TOOLS, runTool } from "./tools.js";
type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
const client = new OpenAI();
const MODEL = "gpt-4o-mini", MAX_STEPS = 10;
export const SYSTEM_PROMPT = `You are a support triage agent.
For each work item the user gives you:
1. Classify it with classifyItem.
2. Search the knowledge base with searchKnowledgeBase if it helps.
3. Draft a reply with draftReply, then send it with sendReply.
Work through every item, then briefly summarize what you did.`;
export const SAMPLE_TASK = `Handle these work items:
- item-1 (customer_message): "I was charged twice and need help."
- item-2 (bug_report): "The export button fails on Safari."
- item-3 (sales_request): "Can you send pricing for 50 seats?"`;
export async function runAgent(task: string): Promise<string | null> {
  const wf = randomUUID().slice(0, 8);
  emit({ type: "workflow.started", workflow: wf, input: task.slice(0, 60) });
  // BRITTLE STATE: if this process dies, the whole conversation dies with it.
  const messages: Msg[] = [{ role: "system", content: SYSTEM_PROMPT },
                           { role: "user", content: task }];
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await client.chat.completions.create({ model: MODEL, messages, tools: TOOLS });
    const msg = r.choices[0].message;
    messages.push(msg);
    if (!msg.tool_calls?.length) {
      emit({ type: "workflow.completed", workflow: wf,
             output: (msg.content ?? "").slice(0, 60) });
      return msg.content;
    }
    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments);
      emit({ type: "tool.requested", workflow: wf, name: call.function.name, args });
      const result = runTool(call.function.name, args); // runs INSTANTLY. unmediated.
      emit({ type: "tool.completed", workflow: wf, call: call.id });
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  emit({ type: "workflow.failed", workflow: wf, error: "hit the step limit" });
  return null;
}
if (import.meta.url === `file://${process.argv[1]}`) await runAgent(SAMPLE_TASK);
