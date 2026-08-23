// harness.ts — Part 2: THE DURABLE LOOP. Same shape as Part 1, but every model
// turn and every tool call is a checkpointed step — and the loop body itself is
// DETERMINISTIC: on replay it rebuilds `messages` from cached step results
// without touching the network. All non-determinism (the model, the tools, the
// clock) lives inside steps. That's the golden rule of durable workflows.
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import readline from "node:readline/promises";
import { emit } from "./events.js";
import { TOOLS, runTool, type Tool } from "./tools.js";
import { Workflow, Suspended, pending } from "./durable.js";
type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
// The plain, JSON-able shape we checkpoint (not the SDK's rich message object):
export interface AssistantMsg { role: "assistant"; content: string | null;
  tool_calls?: { id: string; type: "function";
                 function: { name: string; arguments: string } }[]; }
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
export async function modelTurn(context: Msg[], tools: Tool[] = TOOLS): Promise<AssistantMsg> {
  const r = await client.chat.completions.create({ model: MODEL, messages: context, tools });
  const m = r.choices[0].message;
  const msg: AssistantMsg = { role: "assistant", content: m.content }; // a plain object:
  if (m.tool_calls?.length) {                                          // JSON-able -> checkpointable
    msg.tool_calls = m.tool_calls.map((c) => ({ id: c.id, type: "function",
      function: { name: c.function.name, arguments: c.function.arguments } }));
  }
  return msg;
}
export async function agentWorkflow(wf: Workflow): Promise<string | null> {
  await wf.runStep("started", () => emit({ type: "workflow.started",
    workflow: wf.id, input: (wf.input ?? "").slice(0, 60) }));
  const messages: Msg[] = [{ role: "system", content: SYSTEM_PROMPT },
                           { role: "user", content: wf.input ?? "" }];
  for (let step = 0; step < MAX_STEPS; step++) {
    // DEMO HELPER (not in the handout): CRASH_AT_STEP=2 npx tsx harness.ts
    // simulates the process dying mid-workflow, after real side effects ran.
    if (process.env.CRASH_AT_STEP && step === Number(process.env.CRASH_AT_STEP)
        && !(`model-${step}` in wf.steps)) {
      console.log(`\n  💥 simulated crash before step ${step} (CRASH_AT_STEP)`);
      process.exit(1);
    }
    const msg = await wf.runStep(`model-${step}`, () => modelTurn(messages));
    messages.push(msg);
    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      await wf.runStep("completed", () => emit({ type: "workflow.completed",
        workflow: wf.id, output: (msg.content ?? "").slice(0, 60) }));
      wf.finish();
      return msg.content;
    }
    for (const call of calls) {
      const result = await wf.runStep(`tool-${call.id}`, () => {
        const args = JSON.parse(call.function.arguments);
        emit({ type: "tool.requested", workflow: wf.id, call: call.id,
               name: call.function.name, args });
        return runTool(call.function.name, args);
      });
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  wf.finish("failed");
  return "";
}
// The runner: recover FIRST, then take new work. Exactly what a durable engine
// does on launch — find every mid-flight workflow and replay it forward.
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const wfId of pending()) {
    console.log(`recovering ${wfId} from its last completed step ...`);
    try { await agentWorkflow(new Workflow(wfId)); }
    catch (e) { if (e instanceof Suspended) console.log(`${wfId} is waiting for a human (Part 7).`);
                else throw e; }
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const task = (await rl.question("task > ")).trim() || SAMPLE_TASK;
  rl.close();
  await agentWorkflow(new Workflow(randomUUID().slice(0, 8), task));
}
