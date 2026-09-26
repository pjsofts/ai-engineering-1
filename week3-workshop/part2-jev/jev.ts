// jev.ts — Part 2 + Jev: a tiny client for TypeSafe's System One model, Jev.
// Jev never writes text. You give it STATE (the facts) and typed QUESTIONS;
// it returns typed ANSWERS with probabilities, in one fast call. We use raw
// fetch (not the SDK) so the exact request and response are visible in the
// event stream: jev.requested shows what we asked, jev.answered what came back.
import { emit } from "./events.js";

const URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";

export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "noul"; noul: number }
  | { type: "score"; score: number; legend: Record<string, string>;
      probabilities: Record<string, number>; confidence: number };

export interface JevResult { answers: Record<string, JevAnswer>;
  usage?: { input_tokens: number; output_tokens: number }; latency_ms: number; }

// Raw call, no events: returns answers + timing. The benchmark uses this directly.
export async function callJev(state: unknown, questions: Record<string, JevQuestion>)
    : Promise<JevResult & { retries: number }> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY is not set (add it to week3-workshop/.env)");
  const t0 = Date.now();
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, state, questions }),
    });
    if ((r.status === 429 || r.status === 529) && attempt < 3) {   // back off and retry
      await new Promise((ok) => setTimeout(ok, 500 * 2 ** attempt));
      continue;
    }
    if (!r.ok) throw new Error(`Jev ${r.status}: ${await r.text()}`);
    const body = await r.json();
    return { answers: body.answers, usage: body.usage,
             latency_ms: Date.now() - t0, retries: attempt };
  }
}

// The harness's call: same thing, wrapped in events so the GUI can show it.
// `purpose` labels the call in the event stream (e.g. "triage item-1").
export async function askJev(workflow: string, purpose: string, state: unknown,
                             questions: Record<string, JevQuestion>): Promise<JevResult> {
  emit({ type: "jev.requested", workflow, purpose, model: MODEL, state, questions });
  const { retries, ...result } = await callJev(state, questions);
  emit({ type: "jev.answered", workflow, purpose, ...result });
  return result;
}
