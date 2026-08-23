// supervisor.ts — PLAN -> DISPATCH (parallel) -> FAN-IN -> SYNTHESIZE. Unlike a
// handoff, the supervisor KEEPS control: sub-agents are function calls. The
// plan is a FIRST-CLASS ARTIFACT — a structured object (via the API's
// JSON-schema mode) that's emitted, checkpointed, and read by synthesis.
import OpenAI from "openai";
import { emit } from "./events.js";
import { runInvestigator } from "./investigators.js";
import type { Workflow } from "./durable.js";
const client = new OpenAI();
const MODEL = "gpt-4o-mini";
interface PlanStep {
  id: string;
  agent: "billing" | "technical" | "sales";
  objective: string;
}
interface Finding {
  agent: string;
  findings: string;
}
const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          agent: { type: "string", enum: ["billing", "technical", "sales"] },
          objective: { type: "string" },
        },
        required: ["id", "agent", "objective"],
      },
    },
  },
  required: ["steps"],
};
async function makePlan(task: string): Promise<PlanStep[]> {
  const r = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Decompose a customer escalation into independent sub-tasks - one " +
          "per area the message actually raises (billing / technical / " +
          "sales). Only include relevant areas.",
      },
      { role: "user", content: task },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "plan", strict: true, schema: PLAN_SCHEMA },
    },
  });
  console.log("plan is", JSON.parse(r.choices[0].message.content ?? "{}"));
  return JSON.parse(r.choices[0].message.content ?? "{}").steps;
}
async function synthesize(
  task: string,
  findings: Finding[],
): Promise<string | null> {
  const joined =
    findings.map((f) => `[${f.agent}] ${f.findings}`).join("\n\n") || "(none)";
  const r = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a support lead. Using your investigators' findings, write ONE " +
          "clear, friendly reply that addresses every point the customer raised. " +
          "If an area's investigation is missing, acknowledge it briefly and say " +
          "you'll follow up.",
      },
      {
        role: "user",
        content: `Customer escalation:\n${task}\n\nInvestigator findings:\n${joined}`,
      },
    ],
  });
  return r.choices[0].message.content;
}
export async function supervisorWorkflow(wf: Workflow): Promise<string | null> {
  await wf.runStep("started", () =>
    emit({
      type: "workflow.started",
      workflow: wf.id,
      input: (wf.input ?? "").slice(0, 60),
    }),
  );
  // PLAN — checkpointed, so a crash after planning never re-plans.
  const plan: PlanStep[] = await wf.runStep("plan", () =>
    makePlan(wf.input ?? ""),
  );
  await wf.runStep("plan-emit", () =>
    emit({
      type: "plan.created",
      workflow: wf.id,
      steps: plan.map((s) => s.agent),
    }),
  );
  // DISPATCH — every investigator runs CONCURRENTLY, each as a durable step,
  // each in its own context window. allSettled means one crash can't take the
  // supervisor down.
  const settled = await Promise.allSettled(
    plan.map((s) =>
      wf.runStep(`subagent-${s.id}`, async (): Promise<Finding> => {
        emit({
          type: "subagent.started",
          workflow: wf.id,
          agent: s.agent,
          objective: s.objective.slice(0, 60),
        });
        const findings = await runInvestigator(s.agent, s.objective);
        emit({ type: "subagent.completed", workflow: wf.id, agent: s.agent });
        return { agent: s.agent, findings };
      }),
    ),
  );
  // FAN-IN — keep the successes, RECORD the failures, and keep going.
  const findings: Finding[] = [];
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    if (outcome.status === "fulfilled") {
      findings.push(outcome.value);
    } else {
      await wf.runStep(`subagent-failed-${plan[i].id}`, () =>
        emit({
          type: "subagent.failed",
          workflow: wf.id,
          agent: plan[i].agent,
          error: String(outcome.reason).slice(0, 80),
        }),
      );
    }
  }
  // SYNTHESIZE from whatever survived. Partial results beat no results.
  const reply = await wf.runStep("synthesize", () =>
    synthesize(wf.input ?? "", findings),
  );
  await wf.runStep("completed", () =>
    emit({
      type: "workflow.completed",
      workflow: wf.id,
      output: (reply ?? "").slice(0, 60),
    }),
  );
  wf.finish();
  return reply;
}
