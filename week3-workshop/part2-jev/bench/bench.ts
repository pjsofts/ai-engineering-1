// bench.ts — measure Jev on the three jobs it does in Part 2+, and compare it
// with the obvious alternative: asking the LLM (gpt-4o-mini) the SAME questions
// through structured output. Speed = wall-clock per call (after one warm-up).
// Accuracy = agreement with the hand labels in dataset.ts.
//   npm run part2jev:bench                  # Jev + LLM baseline (from week3-workshop/)
//   npm run part2jev:bench -- --jev-only
// Results land in bench/results/latest.json (the GUI's Benchmark tab reads it).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { callJev, type JevQuestion } from "../jev.js";
import { CATEGORY, articleQuestion, VERIFY_QUESTIONS, ARTICLE_THRESHOLD, GATE_THRESHOLD } from "../harness.js";
import { KNOWLEDGE_BASE } from "../tools.js";
import { TRIAGE, VERIFY, type TriageCase, type VerifyCase, type Topic } from "./dataset.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LLM_MODEL = "gpt-4o-mini";
const TOPICS = Object.keys(KNOWLEDGE_BASE) as Topic[];
type System = "jev" | "llm";
// Answers normalised across systems: choice -> string, noul -> probability
// (Jev) or 0/1 (the LLM gives a label, not a probability).
type Answers = Record<string, string | number>;
interface Call { answers: Answers; latency_ms: number; tokens: number }

// ---------------- the two systems, same state + same questions ----------------
const triageQuestions = (): Record<string, JevQuestion> => {
  const q: Record<string, JevQuestion> = { category: CATEGORY };
  for (const t of TOPICS) q[`kb_${t}`] = articleQuestion(t);
  return q;
};
const triageState = (c: TriageCase) =>
  ({ item: { id: c.id, kind: "message", text: c.text }, kb: KNOWLEDGE_BASE });
const verifyState = (c: VerifyCase) =>
  ({ customer_message: c.customer, articles: c.topics.map((t) => KNOWLEDGE_BASE[t]), draft: c.draft });

async function askJevSystem(state: unknown, qs: Record<string, JevQuestion>): Promise<Call> {
  const r = await callJev(state, qs);
  const answers: Answers = {};
  for (const [k, a] of Object.entries(r.answers))
    answers[k] = a.type === "choice" ? a.choice : a.type === "noul" ? a.noul : a.score;
  return { answers, latency_ms: r.latency_ms,
           tokens: (r.usage?.input_tokens ?? 0) + (r.usage?.output_tokens ?? 0) };
}

let openai: OpenAI | null = null;
async function askLlmSystem(state: unknown, qs: Record<string, JevQuestion>): Promise<Call> {
  openai ??= new OpenAI();
  // Each Jev question becomes one field of a strict JSON schema:
  // choice -> enum of its options, noul -> boolean.
  const props: Record<string, unknown> = {};
  for (const [k, q] of Object.entries(qs))
    props[k] = q.type === "choice" ? { type: "string", enum: Object.keys(q.criteria) }
             : { type: "boolean" };
  const prompt = `STATE:\n${JSON.stringify(state, null, 2)}\n\nQUESTIONS:\n` +
    Object.entries(qs).map(([k, q]) => `- ${k} (${q.type}): ${q.instructions}\n` +
      (q.criteria ? `  criteria: ${JSON.stringify(q.criteria)}` : "")).join("\n");
  const t0 = Date.now();
  const r = await openai.chat.completions.create({
    model: LLM_MODEL, temperature: 0,
    messages: [{ role: "system", content: "Answer every question about STATE. " +
      "Backticked paths refer to fields of STATE. For boolean questions answer true or false." },
               { role: "user", content: prompt }],
    response_format: { type: "json_schema", json_schema: { name: "answers", strict: true,
      schema: { type: "object", properties: props, required: Object.keys(qs),
                additionalProperties: false } } },
  });
  const raw = JSON.parse(r.choices[0].message.content ?? "{}");
  const answers: Answers = {};
  for (const [k, v] of Object.entries(raw)) answers[k] = typeof v === "boolean" ? Number(v) : String(v);
  return { answers, latency_ms: Date.now() - t0, tokens: r.usage?.total_tokens ?? 0 };
}
const SYSTEMS: Record<System, typeof askJevSystem> = { jev: askJevSystem, llm: askLlmSystem };

// ---------------- scoring ----------------
const p = (a: Answers, k: string) => Number(a[k]);
function scoreTriage(c: TriageCase, a: Answers, threshold = ARTICLE_THRESHOLD) {
  const category = String(a.category);
  const picked = TOPICS.filter((t) => p(a, `kb_${t}`) >= threshold);
  const allowed = new Set([...c.need, ...(c.ok ?? [])]);
  const tp = picked.filter((t) => c.need.includes(t)).length;
  const fp = picked.filter((t) => !allowed.has(t)).length;
  const fn = c.need.filter((t) => !picked.includes(t)).length;
  return { category, category_ok: category === c.category || !!c.alsoOk?.includes(category as any),
           picked, tp, fp, fn, articles_ok: fp === 0 && fn === 0 };
}
function scoreVerify(c: VerifyCase, a: Answers, threshold = GATE_THRESHOLD) {
  const g = p(a, "grounded") >= threshold, o = p(a, "on_topic") >= threshold;
  const shouldBlock = !c.grounded || !c.on_topic, blocked = !g || !o;
  return { grounded: g, on_topic: o, grounded_ok: g === c.grounded, on_topic_ok: o === c.on_topic,
           blocked, should_block: shouldBlock, decision_ok: blocked === shouldBlock };
}

// ---------------- runner ----------------
export interface BenchOpts { systems?: System[]; concurrency?: number }
export type Progress = (m: { done: number; total: number; label: string }) => void;

async function pool<T>(jobs: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); }
  }));
  return out;
}
const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const rate = (xs: boolean[]) => xs.length ? xs.filter(Boolean).length / xs.length : 0;

export async function runBench(opts: BenchOpts = {}, onProgress: Progress = () => {}) {
  const systems = opts.systems ?? ["jev", "llm"];
  const concurrency = opts.concurrency ?? 4;
  const total = systems.length * (TRIAGE.length + VERIFY.length);
  let done = 0;
  // Warm-up (not measured): first calls pay for DNS + TLS handshakes.
  for (const s of systems) await SYSTEMS[s](verifyState(VERIFY[0]), VERIFY_QUESTIONS);

  const raw: Record<System, { triage: Call[]; verify: Call[] }> = {} as any;
  for (const s of systems) {
    const tick = (label: string) => onProgress({ done: ++done, total, label: `${s}: ${label}` });
    const triage = await pool(TRIAGE.map((c) => async () => {
      const r = await SYSTEMS[s](triageState(c), triageQuestions()); tick(c.id); return r; }), concurrency);
    const verify = await pool(VERIFY.map((c) => async () => {
      const r = await SYSTEMS[s](verifyState(c), VERIFY_QUESTIONS); tick(c.id); return r; }), concurrency);
    raw[s] = { triage, verify };
  }

  const summary: Record<string, any> = {};
  for (const s of systems) {
    const T = TRIAGE.map((c, i) => scoreTriage(c, raw[s].triage[i].answers));
    const V = VERIFY.map((c, i) => scoreVerify(c, raw[s].verify[i].answers));
    const tp = T.reduce((n, x) => n + x.tp, 0), fp = T.reduce((n, x) => n + x.fp, 0),
          fn = T.reduce((n, x) => n + x.fn, 0);
    const lat = (calls: Call[]) => { const xs = calls.map((c) => c.latency_ms);
      return { p50: pct(xs, 0.5), p95: pct(xs, 0.95), mean: Math.round(mean(xs)), max: Math.max(...xs) }; };
    summary[s] = {
      accuracy: {
        category: rate(T.map((x) => x.category_ok)),
        articles_exact: rate(T.map((x) => x.articles_ok)),
        articles_precision: tp + fp ? tp / (tp + fp) : 1,
        articles_recall: tp + fn ? tp / (tp + fn) : 1,
        grounded: rate(V.map((x) => x.grounded_ok)),
        on_topic: rate(V.map((x) => x.on_topic_ok)),
        gate_decision: rate(V.map((x) => x.decision_ok)),
        bad_drafts_caught: rate(V.filter((x) => x.should_block).map((x) => x.blocked)),
        good_drafts_passed: rate(V.filter((x) => !x.should_block).map((x) => !x.blocked)),
      },
      latency_ms: { triage: lat(raw[s].triage), verify: lat(raw[s].verify),
                    all: lat([...raw[s].triage, ...raw[s].verify]) },
      tokens: { triage: mean(raw[s].triage.map((c) => c.tokens)),
                verify: mean(raw[s].verify.map((c) => c.tokens)) },
    };
  }

  // Jev returns probabilities, so we can ask a question the LLM can't answer:
  // how does accuracy move as the THRESHOLD (a policy knob in code) moves?
  let sweep: any = null, brier: any = null;
  if (raw.jev) {
    const ths = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    sweep = ths.map((th) => {
      const T = TRIAGE.map((c, i) => scoreTriage(c, raw.jev.triage[i].answers, th));
      const V = VERIFY.map((c, i) => scoreVerify(c, raw.jev.verify[i].answers, th));
      return { threshold: th, articles_exact: rate(T.map((x) => x.articles_ok)),
        gate_decision: rate(V.map((x) => x.decision_ok)),
        bad_drafts_caught: rate(V.filter((x) => x.should_block).map((x) => x.blocked)),
        good_drafts_passed: rate(V.filter((x) => !x.should_block).map((x) => !x.blocked)) };
    });
    // Brier score: mean (probability − truth)², 0 = perfect, 0.25 = coin flip.
    const sq: number[] = [];
    TRIAGE.forEach((c, i) => TOPICS.forEach((t) => {
      if (c.ok?.includes(t)) return;                  // "optional" articles have no truth
      sq.push((p(raw.jev.triage[i].answers, `kb_${t}`) - Number(c.need.includes(t))) ** 2); }));
    const art = mean(sq);
    const gsq = VERIFY.flatMap((c, i) => [
      (p(raw.jev.verify[i].answers, "grounded") - Number(c.grounded)) ** 2,
      (p(raw.jev.verify[i].answers, "on_topic") - Number(c.on_topic)) ** 2]);
    brier = { articles: art, gate: mean(gsq) };
  }

  const cases = {
    triage: TRIAGE.map((c, i) => ({ ...c, results: Object.fromEntries(systems.map((s) => [s, {
      ...scoreTriage(c, raw[s].triage[i].answers), answers: raw[s].triage[i].answers,
      latency_ms: raw[s].triage[i].latency_ms }])) })),
    verify: VERIFY.map((c, i) => ({ ...c, results: Object.fromEntries(systems.map((s) => [s, {
      ...scoreVerify(c, raw[s].verify[i].answers), answers: raw[s].verify[i].answers,
      latency_ms: raw[s].verify[i].latency_ms }])) })),
  };
  const result = { ran_at: new Date().toISOString(), systems, concurrency,
    llm_model: LLM_MODEL, jev_model: "jev-latest",
    thresholds: { article: ARTICLE_THRESHOLD, gate: GATE_THRESHOLD },
    n: { triage: TRIAGE.length, verify: VERIFY.length }, summary, sweep, brier, cases };
  const dir = path.join(HERE, "results");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(dir, `bench-${result.ran_at.replace(/[:.]/g, "-")}.json`),
    JSON.stringify(result, null, 2));
  return result;
}

// ---------------- CLI ----------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runBench({ systems: process.argv.includes("--jev-only") ? ["jev"] : ["jev", "llm"] },
    ({ done, total, label }) => process.stdout.write(`\r  ${done}/${total}  ${label.padEnd(12)}`));
  console.log("\n");
  const f = (x: number) => `${(x * 100).toFixed(0)}%`.padStart(6);
  const rows: [string, (s: any) => string][] = [
    ["category accuracy", (s) => f(s.accuracy.category)],
    ["articles exact", (s) => f(s.accuracy.articles_exact)],
    ["articles precision", (s) => f(s.accuracy.articles_precision)],
    ["articles recall", (s) => f(s.accuracy.articles_recall)],
    ["grounded accuracy", (s) => f(s.accuracy.grounded)],
    ["on_topic accuracy", (s) => f(s.accuracy.on_topic)],
    ["gate decision", (s) => f(s.accuracy.gate_decision)],
    ["bad drafts caught", (s) => f(s.accuracy.bad_drafts_caught)],
    ["good drafts passed", (s) => f(s.accuracy.good_drafts_passed)],
    ["latency p50 (ms)", (s) => String(s.latency_ms.all.p50).padStart(6)],
    ["latency p95 (ms)", (s) => String(s.latency_ms.all.p95).padStart(6)],
  ];
  console.log("  metric".padEnd(22) + r.systems.map((s) => s.padStart(8)).join(""));
  for (const [name, fn] of rows)
    console.log(`  ${name.padEnd(20)}` + r.systems.map((s) => fn(r.summary[s]).padStart(8)).join(""));
  if (r.brier) console.log(`\n  Jev Brier score: articles ${r.brier.articles.toFixed(3)}, gate ${r.brier.gate.toFixed(3)} (0 = perfect, 0.25 = coin flip)`);
  console.log("\n  wrote bench/results/latest.json");
}
