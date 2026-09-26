// harness.ts — Part 2 + JEV. The same durable loop as Part 2, but three jobs
// move from the LLM to Jev (TypeSafe's System One model), which returns typed
// judgments with probabilities instead of text:
//   1. CLASSIFY  — a Jev `choice` picks each item's category (was: the LLM
//                  calling classifyItem, which just echoed its own guess).
//   2. RETRIEVE  — one Jev `noul` per KB article: "does this article help?"
//                  (was: searchKB's substring match on the query string).
//   3. VERIFY    — before sendReply, two Jev `noul`s check the draft is grounded
//                  in the articles and answers the customer. Code decides.
// The LLM keeps the one job only it can do: WRITING the reply.
// Every Jev call is a checkpointed step, so replay after a crash re-uses the
// cached answers — no second call, same decision.
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import readline from "node:readline/promises";
import { emit } from "./events.js";
import { TOOLS, runTool, KNOWLEDGE_BASE, type Tool } from "./tools.js";
import { Workflow, Suspended, pending } from "./durable.js";
import { askJev, type JevQuestion } from "./jev.js";
type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export interface AssistantMsg { role: "assistant"; content: string | null;
  tool_calls?: { id: string; type: "function";
                 function: { name: string; arguments: string } }[]; }
const client = new OpenAI();
const MODEL = "gpt-4o-mini", MAX_STEPS = 12;
// Thresholds are POLICY, and they live in code — not in the model.
export const ARTICLE_THRESHOLD = 0.5;   // include a KB article when P(helps) >= this
export const GATE_THRESHOLD = 0.5;     // block a send when P(grounded) or P(on-topic) < this
const LOW_CONFIDENCE = 0.6;      // flag a category choice below this confidence

export const SYSTEM_PROMPT = `You are a support reply agent.
Every work item has already been triaged by Jev (a fast classifier): its
category, the classifier's confidence, and the relevant knowledge-base
articles are listed below the task. Do not reclassify or search.
For each item:
1. Draft a reply with draftReply using ONLY facts from that item's articles
   (if it has none, acknowledge the request and say a specialist will follow up).
2. Send it with sendReply.
A quality check runs before every send. If a send comes back blocked, read the
reason, redraft that item once, and send again.
Finish with a brief summary of what you did.`;
export const SAMPLE_TASK = `Handle these work items:
- item-1 (customer_message): "I was charged twice and need help."
- item-2 (bug_report): "The export button fails on Safari."
- item-3 (sales_request): "Can you send pricing for 50 seats?"`;

interface Item { id: string; kind: string; text: string }
interface Triage { item_id: string; category: string; confidence: number;
  low_confidence: boolean; articles: { topic: string; p: number; text: string }[] }

// Plain code, no model: pull `- item-N (kind): "text"` lines out of the task.
function parseItems(task: string): Item[] {
  const items = [...task.matchAll(/-\s*(item-\d+)\s*\(([^)]*)\):\s*"([^"]*)"/g)]
    .map(([, id, kind, text]) => ({ id, kind, text }));
  return items.length ? items : [{ id: "item-1", kind: "message", text: task.trim() }];
}

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

// ---- Jev jobs 1 + 2: one request per item, all questions asked together ----
// Questions are exported so bench/ evaluates EXACTLY what the agent asks.
export const CATEGORY: JevQuestion = {
  type: "choice",
  instructions: "Which support team should handle the customer work item in `item`?",
  criteria: {
    billing: "Charges, payments, invoices, refunds, or subscription billing problems",
    technical: "Bugs, errors, or features of the product not working as expected",
    sales: "Pricing, quotes, buying seats or plans, upgrades, or other purchase questions",
    other: "None of the above",
  },
};
export function articleQuestion(topic: string): JevQuestion {
  return {
    type: "noul",
    instructions: `Would the knowledge-base article in \`kb.${topic}\` give useful facts ` +
      "for replying to the customer work item in `item`?",
    criteria: { true: "The article is directly relevant to what the customer needs",
                false: "The article is about a different problem or request" },
  };
}
async function triage(wf: Workflow, item: Item): Promise<Triage> {
  const questions: Record<string, JevQuestion> = { category: CATEGORY };
  for (const topic of Object.keys(KNOWLEDGE_BASE)) questions[`kb_${topic}`] = articleQuestion(topic);
  const { answers } = await askJev(wf.id, `triage ${item.id}`,
    { item, kb: KNOWLEDGE_BASE }, questions);
  // Jev returned probabilities. CODE turns them into decisions:
  const cat = answers.category as { choice: string; confidence: number };
  const articles = Object.keys(KNOWLEDGE_BASE)
    .map((topic) => ({ topic, p: (answers[`kb_${topic}`] as { noul: number }).noul,
                       text: KNOWLEDGE_BASE[topic] }))
    .filter((a) => a.p >= ARTICLE_THRESHOLD)
    .sort((a, b) => b.p - a.p);
  const t: Triage = { item_id: item.id, category: cat.choice, confidence: cat.confidence,
    low_confidence: cat.confidence < LOW_CONFIDENCE, articles };
  emit({ type: "jev.triaged", workflow: wf.id, ...t,
         article_threshold: ARTICLE_THRESHOLD, low_confidence_below: LOW_CONFIDENCE });
  return t;
}

// ---- Jev job 3: verify a draft before the irreversible sendReply ----
export const VERIFY_QUESTIONS: Record<string, JevQuestion> = {
  grounded: {
    type: "noul",
    instructions: "Is every factual claim in `draft` (prices, timelines, causes, " +
      "workarounds, ticket numbers, policies) stated in or directly implied by " +
      "`articles`? Apologies, courtesy, and offers to help or follow up are not " +
      "factual claims.",
    criteria: { true: "All factual claims in the draft are supported by the articles",
                false: "The draft states at least one fact, number, or promise the articles do not support" },
  },
  on_topic: {
    type: "noul",
    instructions: "Does `draft` respond to the specific problem or request in `customer_message`?",
    criteria: { true: "The draft addresses what the customer asked about",
                false: "The draft ignores or misreads what the customer asked about" },
  },
};

async function verifyDraft(wf: Workflow, item: Item, t: Triage, draft: string) {
  const { answers } = await askJev(wf.id, `verify ${item.id}`,
    { customer_message: item.text, articles: t.articles.map((a) => a.text), draft }, VERIFY_QUESTIONS);
  const grounded = (answers.grounded as { noul: number }).noul;
  const on_topic = (answers.on_topic as { noul: number }).noul;
  const pass = grounded >= GATE_THRESHOLD && on_topic >= GATE_THRESHOLD;
  const reason = pass ? "ok" : [
    grounded < GATE_THRESHOLD && "the draft states facts the KB articles do not support",
    on_topic < GATE_THRESHOLD && "the draft does not address the customer's request",
  ].filter(Boolean).join("; ");
  emit({ type: "jev.gate", workflow: wf.id, item_id: item.id,
         verdict: pass ? "pass" : "blocked", grounded, on_topic,
         threshold: GATE_THRESHOLD, reason });
  return { pass, reason };
}

export async function agentWorkflow(wf: Workflow): Promise<string | null> {
  await wf.runStep("started", () => emit({ type: "workflow.started",
    workflow: wf.id, input: (wf.input ?? "").slice(0, 60) }));
  const items = parseItems(wf.input ?? "");
  const triages: Record<string, Triage> = {};
  for (const item of items)                                  // Jev jobs 1 + 2
    triages[item.id] = await wf.runStep(`jev-triage-${item.id}`, () => triage(wf, item));

  const briefing = items.map((it) => {
    const t = triages[it.id];
    return `- ${it.id}: category=${t.category} (confidence ${t.confidence.toFixed(2)}` +
      `${t.low_confidence ? ", LOW — be cautious" : ""})\n` +
      (t.articles.length ? t.articles.map((a) => `    article [${a.topic}]: ${a.text}`).join("\n")
                         : "    (no relevant articles)");
  }).join("\n");
  const messages: Msg[] = [{ role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `${wf.input ?? ""}\n\nJev triage:\n${briefing}` }];
  // The LLM no longer gets classifyItem or searchKnowledgeBase — Jev did those.
  const tools = TOOLS.filter((t) => ["draftReply", "sendReply"].includes(t.function.name));
  const drafts: Record<string, string> = {};   // rebuilt deterministically on replay

  for (let step = 0; step < MAX_STEPS; step++) {
    // DEMO HELPER: CRASH_AT_STEP=2 simulates the process dying mid-workflow.
    if (process.env.CRASH_AT_STEP && step === Number(process.env.CRASH_AT_STEP)
        && !(`model-${step}` in wf.steps)) {
      console.log(`\n  💥 simulated crash before step ${step} (CRASH_AT_STEP)`);
      process.exit(1);
    }
    const msg = await wf.runStep(`model-${step}`, () => modelTurn(messages, tools));
    messages.push(msg);
    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      await wf.runStep("completed", () => emit({ type: "workflow.completed",
        workflow: wf.id, output: (msg.content ?? "").slice(0, 60) }));
      wf.finish();
      return msg.content;
    }
    for (const call of calls) {
      const args = JSON.parse(call.function.arguments);
      if (call.function.name === "draftReply") drafts[args.item_id] = args.message;
      const item = items.find((i) => i.id === args.item_id);
      if (call.function.name === "sendReply" && item && drafts[item.id]) {
        const gate = await wf.runStep(`jev-verify-${call.id}`,   // Jev job 3
          () => verifyDraft(wf, item, triages[item.id], drafts[item.id]));
        if (!gate.pass) {                    // blocked: sendReply never executes
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(
            { sent: false, blocked_by: "quality check", reason: gate.reason }) });
          continue;
        }
      }
      const result = await wf.runStep(`tool-${call.id}`, () => {
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
// The runner: recover FIRST, then take new work — same as Part 2.
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const wfId of pending()) {
    console.log(`recovering ${wfId} from its last completed step ...`);
    try { await agentWorkflow(new Workflow(wfId)); }
    catch (e) { if (e instanceof Suspended) console.log(`${wfId} is waiting for a human.`);
                else throw e; }
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const task = (await rl.question("task > ")).trim() || SAMPLE_TASK;
  rl.close();
  await agentWorkflow(new Workflow(randomUUID().slice(0, 8), task));
}
