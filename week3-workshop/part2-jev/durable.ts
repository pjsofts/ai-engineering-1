// durable.ts — DURABLE EXECUTION IN ~40 LINES. A workflow is a JSON file; a
// STEP is a named unit of work whose result is checkpointed the moment it
// finishes. Re-run the workflow body and completed steps return their cached
// result instead of executing — so a crash never re-bills the model and never
// re-sends an email. This is the trick inside every durable-execution engine.
import fs from "node:fs";
const STORE = "wf";
fs.mkdirSync(STORE, { recursive: true });
type Status = "running" | "done" | "failed" | "suspended";
interface WorkflowData { input: string | null; status: Status; steps: Record<string, any>; }

export class Suspended extends Error {}   // parks a workflow (Part 7)

export class Workflow {
  id: string;
  path: string;
  input: string | null;
  status: Status;
  steps: Record<string, any>;
  constructor(workflowId: string, input: string | null = null) {
    this.id = workflowId;
    this.path = `${STORE}/${workflowId}.json`;
    const data: WorkflowData = fs.existsSync(this.path)
      ? JSON.parse(fs.readFileSync(this.path, "utf8"))
      : { input, status: "running", steps: {} };
    this.input = data.input;
    this.status = data.status;
    this.steps = data.steps;
    this.save();
  }
  save(): void {
    fs.writeFileSync(this.path, JSON.stringify(
      { input: this.input, status: this.status, steps: this.steps }));
  }
  // completed before the crash -> cached (no model call, no side effect, no cost)
  async runStep<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    if (name in this.steps) return this.steps[name];
    const result = await fn();            // non-determinism and side effects live HERE
    this.steps[name] = result;
    this.save();                          // checkpoint BEFORE moving on
    return result;
  }
  finish(status: Status = "done"): void {
    this.status = status;
    this.save();
  }
}
// Workflows that were mid-flight (or suspended) when the process last died.
export function pending(): string[] {
  return fs.readdirSync(STORE).filter((f) => f.endsWith(".json"))
    .filter((f) => JSON.parse(fs.readFileSync(`${STORE}/${f}`, "utf8")).status === "running")
    .map((f) => f.replace(".json", ""))
    .sort();
}
