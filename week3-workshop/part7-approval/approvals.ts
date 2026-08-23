// approvals.ts — a human decision is just another CHECKPOINTED STEP: one whose
// value comes from a person instead of a function. If the decision isn't there
// yet, the workflow PARKS itself on disk and the process is free to exit —
// thirty seconds or three days, the wait costs nothing and survives restarts.
import fs from "node:fs";
import { emit } from "./events.js";
import { Suspended, type Workflow } from "./durable.js";
interface ToolCall { id: string; function: { name: string; arguments: string }; }
interface Decision { approved: boolean; }
export const NEEDS_APPROVAL = new Set<string>(["issueRefund"]); // the irreversible ones
export async function approvalGate(
  wf: Workflow, call: ToolCall, args: Record<string, any>): Promise<Decision> {
  const step = `approval-${call.id}`;
  if (step in wf.steps) return wf.steps[step];  // replay: the decision is cached
  const decisionFile = `decisions/${wf.id}.json`;
  if (!fs.existsSync(decisionFile)) {           // no human answer yet ->
    emit({ type: "approval.requested", workflow: wf.id,
           action: call.function.name, args });
    wf.finish("suspended");                     // park it. days are fine.
    throw new Suspended(wf.id);
  }
  const decision: Decision = JSON.parse(fs.readFileSync(decisionFile, "utf8"));
  fs.unlinkSync(decisionFile);
  emit({ type: "approval.resolved", workflow: wf.id, approved: decision.approved });
  return wf.runStep(step, () => decision);      // checkpoint the human
}
