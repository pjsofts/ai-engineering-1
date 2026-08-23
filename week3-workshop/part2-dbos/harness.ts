// harness.ts — Part 2, REDONE ON DBOS. Same agent, same demo, same guarantees
// — but the ~40-line durable engine we hand-rolled in part2-durable is gone,
// replaced by a production durable-execution library backed by Postgres.
//
// The mapping is almost one-to-one:
//   our Workflow class        -> DBOS.registerWorkflow(...)  (state in Postgres)
//   our wf.runStep(name, fn)  -> DBOS.runStep(fn, { name })
//   our wf/<id>.json          -> the DBOS system tables
//   our pending() + replay    -> automatic recovery on DBOS.launch()
//
// The golden rule is IDENTICAL: the workflow body must be deterministic; all
// non-determinism (the model, the tools, the clock) lives inside steps. DBOS
// enforces it harder than we did — steps are matched by their order in the
// workflow, so the body must issue the same steps in the same sequence.
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import readline from "node:readline/promises";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { emit } from "./events.js";
import { TOOLS, runTool, type Tool } from "./tools.js";
type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
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

async function modelTurn(context: Msg[], tools: Tool[] = TOOLS): Promise<AssistantMsg> {
  const r = await client.chat.completions.create({ model: MODEL, messages: context, tools });
  const m = r.choices[0].message;
  const msg: AssistantMsg = { role: "assistant", content: m.content };
  if (m.tool_calls?.length) {
    msg.tool_calls = m.tool_calls.map((c) => ({ id: c.id, type: "function",
      function: { name: c.function.name, arguments: c.function.arguments } }));
  }
  return msg;
}

// THE WORKFLOW. Note what's missing compared to part2-durable/harness.ts:
// no Workflow object, no wf.id threading, no save(), no pending() scan.
// DBOS gives the running workflow its identity (DBOS.workflowID).
export const agentWorkflow = DBOS.registerWorkflow(
  async (task: string): Promise<string | null> => {
    const wfId = (DBOS.workflowID ?? "?").slice(0, 8);
    await DBOS.runStep(async () => emit({ type: "workflow.started",
      workflow: wfId, input: task.slice(0, 60) }), { name: "started" });
    const messages: Msg[] = [{ role: "system", content: SYSTEM_PROMPT },
                             { role: "user", content: task }];
    for (let step = 0; step < MAX_STEPS; step++) {
      // DEMO HELPER: CRASH_AT_STEP=2 kills the process mid-workflow, after
      // real side effects have run. DBOS leaves the workflow PENDING.
      if (process.env.CRASH_AT_STEP && step === Number(process.env.CRASH_AT_STEP)) {
        console.log(`\n  💥 simulated crash before step ${step} (CRASH_AT_STEP)`);
        process.exit(1);
      }
      const msg = await DBOS.runStep(() => modelTurn(messages), { name: `model-${step}` });
      messages.push(msg);
      const calls = msg.tool_calls ?? [];
      if (!calls.length) {
        await DBOS.runStep(async () => emit({ type: "workflow.completed",
          workflow: wfId, output: (msg.content ?? "").slice(0, 60) }), { name: "completed" });
        return msg.content;
      }
      for (const call of calls) {
        const result = await DBOS.runStep(async () => {
          const args = JSON.parse(call.function.arguments);
          emit({ type: "tool.requested", workflow: wfId, call: call.id,
                 name: call.function.name, args });
          return runTool(call.function.name, args);
        }, { name: `tool-${call.id}` });
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }
    await DBOS.runStep(async () => emit({ type: "workflow.failed",
      workflow: wfId, error: "hit the step limit" }), { name: "failed" });
    return "";
  }, { name: "agentWorkflow" });

// ---- the runner ------------------------------------------------------------
// DBOS.launch() IS the recovery pass: it finds every PENDING workflow for this
// application version and resumes it in the background.
//
// About the version: DBOS only recovers workflows whose application version
// matches the running code — by default a hash of your code, so editing a file
// orphans workflows parked by the previous build. The npm scripts pin
// DBOS__APPVERSION=week3-demo (it must be set BEFORE the SDK is imported,
// which is why it lives in the script and not here) so a crash and its
// recovery always agree, even if you edit code between the two.
export async function launch(): Promise<void> {
  DBOS.setConfig({ name: "week3",
    systemDatabaseUrl: process.env.DBOS_DATABASE_URL! });
  await DBOS.launch();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await launch();
  if (process.argv.includes("--recover-only")) {
    console.log("launched — DBOS is resuming any PENDING workflow in the background.");
    await new Promise((r) => setTimeout(r, 15000));   // let recovery finish
  } else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const task = (await rl.question("task > ")).trim() || SAMPLE_TASK;
    rl.close();
    const handle = await DBOS.startWorkflow(agentWorkflow,
      { workflowID: randomUUID().slice(0, 8) })(task);
    console.log(`workflow ${handle.workflowID} started`);
    await handle.getResult();
  }
  await DBOS.shutdown();
}
