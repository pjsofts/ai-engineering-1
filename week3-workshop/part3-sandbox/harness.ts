// harness.ts — Part 3: same durable loop as Part 2. What changed is the
// TOOLBOX: the agent now has runCode, so "find the duplicate charge" becomes
// one sandboxed program (fetch + group + dedupe + compute) instead of a chain
// of chatty tool calls with the arithmetic done by the model in its head.
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import readline from "node:readline/promises";
import { emit } from "./events.js";
import { TOOLS, runTool, type Tool } from "./tools.js";
import { Workflow, Suspended, pending } from "./durable.js";
type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export interface AssistantMsg { role: "assistant"; content: string | null;
  tool_calls?: { id: string; type: "function";
                 function: { name: string; arguments: string } }[]; }
const client = new OpenAI();
const MODEL = "gpt-4o-mini", MAX_STEPS = 15;
export const SYSTEM_PROMPT = `You are a support triage agent.
For each work item the user gives you:
1. Classify it with classifyItem.
2. If it needs data lookup or math, use runCode (tools.getCharges and
   tools.searchKnowledgeBase are available inside it).
3. Draft a reply with draftReply, then send it with sendReply.
Work through every item, then briefly summarize what you did.`;
export const SAMPLE_TASK = `Customer cus_88121 says they were charged twice. ` +
  `Find the duplicate and the exact amount to refund, then draft and send a reply.`;
export async function modelTurn(context: Msg[], tools: Tool[] = TOOLS): Promise<AssistantMsg> {
  const r = await client.chat.completions.create({ model: MODEL, messages: context, tools });
  const m = r.choices[0].message;
  const msg: AssistantMsg = { role: "assistant", content: m.content };
  if (m.tool_calls?.length) {
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
        return runTool(call.function.name, args);   // now async: runCode -> sandbox
      });
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  wf.finish("failed");
  return "";
}
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
