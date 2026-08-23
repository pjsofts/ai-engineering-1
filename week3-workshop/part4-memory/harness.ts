// harness.ts — Part 4: the loop keeps TURNS (so compaction cuts at clean
// boundaries), compacts over budget, and hydrates a fresh context every pass.
// The summarizer is an LLM call, so it's a checkpointed step: a crash never
// re-summarizes. Tokens sent stay roughly FLAT no matter how long the task
// runs; the full history still lives, durably, in the event log.
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import readline from "node:readline/promises";
import { emit } from "./events.js";
import { TOOLS, runTool, type Tool } from "./tools.js";
import { Workflow, Suspended, pending } from "./durable.js";
import {
  MAX_CONTEXT_TOKENS,
  KEEP_CONTEXT_TOKENS,
  estimateTokens,
  buildContext,
  summarize,
} from "./memory.js";
type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Turn = Msg[];
export interface AssistantMsg {
  role: "assistant";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
}
const client = new OpenAI();
const MODEL = "gpt-4o-mini",
  MAX_STEPS = 15;
export const SYSTEM_PROMPT = `You are a support triage agent.
For each work item the user gives you:
1. Classify it with classifyItem.
2. If it needs data lookup or math, use runCode (tools.getCharges and
   tools.searchKnowledgeBase are available inside it).
3. Draft a reply with draftReply, then send it with sendReply.
Work through every item, then briefly summarize what you did.`;
export const SAMPLE_TASK = `Handle these work items:
- item-1 (customer_message): "I was charged twice and need help." (customer: cus_88121)
- item-2 (bug_report): "The export button fails on Safari."
- item-3 (sales_request): "Can you send pricing for 50 seats?"`;
export async function modelTurn(
  context: Msg[],
  tools: Tool[] = TOOLS,
): Promise<AssistantMsg> {
  const r = await client.chat.completions.create({
    model: MODEL,
    messages: context,
    tools,
  });
  const m = r.choices[0].message;
  const msg: AssistantMsg = { role: "assistant", content: m.content };
  if (m.tool_calls?.length) {
    msg.tool_calls = m.tool_calls.map((c) => ({
      id: c.id,
      type: "function",
      function: { name: c.function.name, arguments: c.function.arguments },
    }));
  }
  return msg;
}
export async function agentWorkflow(wf: Workflow): Promise<string | null> {
  await wf.runStep("started", () =>
    emit({
      type: "workflow.started",
      workflow: wf.id,
      input: (wf.input ?? "").slice(0, 60),
    }),
  );
  const turns: Turn[] = []; // <- replaces the flat `messages` array
  let summary = "";
  for (let step = 0; step < MAX_STEPS; step++) {
    // 1. Over budget? Peel the oldest turns into the running summary.
    if (estimateTokens(turns.flat()) > MAX_CONTEXT_TOKENS) {
      const old: Turn[] = [];
      while (
        turns.length > 1 &&
        estimateTokens(turns.flat()) > KEEP_CONTEXT_TOKENS
      ) {
        old.push(turns.shift()!);
      }
      if (old.length) {
        summary =
          (await wf.runStep(`summarize-${step}`, () =>
            summarize(old, summary),
          )) ?? summary;
        await wf.runStep(`compacted-${step}`, () =>
          emit({
            type: "memory.compacted",
            workflow: wf.id,
            summarized_turns: old.length,
            context_tokens: estimateTokens(
              buildContext(SYSTEM_PROMPT, wf.input ?? "", summary, turns),
            ),
          }),
        );
      }
    }
    console.log("summary is", summary);
    // 2 + 3. Hydrate fresh, run ONE turn over the hydrated context.
    const context = buildContext(SYSTEM_PROMPT, wf.input ?? "", summary, turns);
    const msg = await wf.runStep(`model-${step}`, () => modelTurn(context));
    const turnMessages: Turn = [msg];
    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      await wf.runStep("completed", () =>
        emit({
          type: "workflow.completed",
          workflow: wf.id,
          output: (msg.content ?? "").slice(0, 60),
        }),
      );
      wf.finish();
      return msg.content;
    }
    for (const call of calls) {
      const result = await wf.runStep(`tool-${call.id}`, () => {
        const args = JSON.parse(call.function.arguments);
        emit({
          type: "tool.requested",
          workflow: wf.id,
          call: call.id,
          name: call.function.name,
          args,
        });
        return runTool(call.function.name, args);
      });
      turnMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
    turns.push(turnMessages); // one clean compaction boundary per pass
  }
  wf.finish("failed");
  return "";
}
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const wfId of pending()) {
    console.log(`recovering ${wfId} from its last completed step ...`);
    try {
      await agentWorkflow(new Workflow(wfId));
    } catch (e) {
      if (e instanceof Suspended)
        console.log(`${wfId} is waiting for a human (Part 7).`);
      else throw e;
    }
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const task = (await rl.question("task > ")).trim() || SAMPLE_TASK;
  rl.close();
  await agentWorkflow(new Workflow(randomUUID().slice(0, 8), task));
}
