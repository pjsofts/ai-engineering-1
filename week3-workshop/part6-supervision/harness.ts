// harness.ts — Part 6: same runtime as Part 5, plus a SUPERVISED mode.
// `--supervised` routes the task through supervisorWorkflow: plan -> parallel
// investigators -> fan-in -> synthesize. Supervised workflow ids get a "sup-"
// prefix so the recovery pass knows which replayer owns them.
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import readline from "node:readline/promises";
import { emit } from "./events.js";
import { runTool, type Tool } from "./tools.js";
import { Workflow, Suspended, pending } from "./durable.js";
import { MAX_CONTEXT_TOKENS, KEEP_CONTEXT_TOKENS,
         estimateTokens, buildContext, summarize } from "./memory.js";
import { AGENTS, TRIAGE, type Agent } from "./agents.js";
import { supervisorWorkflow } from "./supervisor.js";
type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Turn = Msg[];
export interface AssistantMsg { role: "assistant"; content: string | null;
  tool_calls?: { id: string; type: "function";
                 function: { name: string; arguments: string } }[]; }
type ToolCall = NonNullable<AssistantMsg["tool_calls"]>[number];
const client = new OpenAI();
const MODEL = "gpt-4o-mini", MAX_STEPS = 15;
export const SAMPLE_TASK =
  `Customer cus_88121 was charged twice and wants the duplicate refunded.`;
export const SAMPLE_ESCALATION =
  `Customer cus_88121: double-charged, the export is broken in Safari, ` +
  `and they want 50-seat pricing.`;
export async function modelTurn(context: Msg[], tools: Tool[]): Promise<AssistantMsg> {
  const r = await client.chat.completions.create({ model: MODEL, messages: context, tools });
  const m = r.choices[0].message;
  const msg: AssistantMsg = { role: "assistant", content: m.content };
  if (m.tool_calls?.length) {
    msg.tool_calls = m.tool_calls.map((c) => ({ id: c.id, type: "function",
      function: { name: c.function.name, arguments: c.function.arguments } }));
  }
  return msg;
}
// One durable, event-emitting tool execution (everything except handoff).
const execTool = (wf: Workflow, call: ToolCall): Promise<string> =>
  wf.runStep(`tool-${call.id}`, () => {
    const args = JSON.parse(call.function.arguments);
    emit({ type: "tool.requested", workflow: wf.id, call: call.id,
           name: call.function.name, args });
    return runTool(call.function.name, args);
  });
export async function agentWorkflow(wf: Workflow): Promise<string | null> {
  await wf.runStep("started", () => emit({ type: "workflow.started",
    workflow: wf.id, input: (wf.input ?? "").slice(0, 60) }));
  const turns: Turn[] = [];
  let summary = "";
  let current: Agent = TRIAGE;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (estimateTokens(turns.flat()) > MAX_CONTEXT_TOKENS) {
      const old: Turn[] = [];
      while (turns.length > 1 && estimateTokens(turns.flat()) > KEEP_CONTEXT_TOKENS) {
        old.push(turns.shift()!);
      }
      if (old.length) {
        summary = (await wf.runStep(`summarize-${step}`,
                                    () => summarize(old, summary))) ?? summary;
        await wf.runStep(`compacted-${step}`, () => emit({
          type: "memory.compacted", workflow: wf.id, summarized_turns: old.length }));
      }
    }
    // Hydrate with the CURRENT agent's prompt and tool subset.
    const context = buildContext(current.systemPrompt, wf.input ?? "", summary, turns);
    const msg = await wf.runStep(`model-${step}`,
                                 () => modelTurn(context, current.tools));
    const turnMessages: Turn = [msg];
    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      await wf.runStep("completed", () => emit({ type: "workflow.completed",
        workflow: wf.id, output: (msg.content ?? "").slice(0, 60) }));
      wf.finish();
      return msg.content;
    }
    for (const call of calls) {
      const args = JSON.parse(call.function.arguments);
      let result: string;
      if (call.function.name === "handoff") {
        const to = args.to as string;
        await wf.runStep(`handoff-${call.id}`, () => emit({
          type: "agent.handoff", workflow: wf.id,
          from: current.name, to, reason: (args.reason ?? "").slice(0, 60) }));
        current = AGENTS[to] ?? current;               // <- the actual handoff
        result = JSON.stringify({ ok: true, message:
          `You are now the ${to} specialist. Take over and FINISH ` +
          `the task by calling the tools you need - do the work, ` +
          `don't just acknowledge the handoff.` });
      } else {
        result = await execTool(wf, call);
      }
      turnMessages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
    turns.push(turnMessages);
  }
  wf.finish("failed");
  return "";
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const supervised = process.argv.includes("--supervised");
  for (const wfId of pending()) {
    console.log(`recovering ${wfId} from its last completed step ...`);
    const replay = wfId.startsWith("sup-") ? supervisorWorkflow : agentWorkflow;
    try { await replay(new Workflow(wfId)); }
    catch (e) { if (e instanceof Suspended) console.log(`${wfId} is waiting for a human (Part 7).`);
                else throw e; }
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const fallback = supervised ? SAMPLE_ESCALATION : SAMPLE_TASK;
  const task = (await rl.question("task > ")).trim() || fallback;
  rl.close();
  if (supervised) {
    const reply = await supervisorWorkflow(
      new Workflow(`sup-${randomUUID().slice(0, 8)}`, task));
    console.log(`\n--- synthesized reply ---\n${reply}`);
  } else {
    await agentWorkflow(new Workflow(randomUUID().slice(0, 8), task));
  }
}
