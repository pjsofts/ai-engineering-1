// inspectDbos.ts — the same "show me the receipts" move as inspectLog.ts, but
// the receipts come from the engine instead of our own JSONL. DBOS records
// every workflow and every step it ran, with inputs, outputs, and timings —
// this is what you get for free when you stop hand-rolling the store.
//
//   npx tsx --env-file=../.env inspectDbos.ts            # list workflows
//   npx tsx --env-file=../.env inspectDbos.ts <wf-id>    # steps of one workflow
import { DBOS } from "@dbos-inc/dbos-sdk";
import { launch } from "./harness.js";

await launch();
const wfId = process.argv[2];

if (!wfId) {
  const wfs = await DBOS.listWorkflows({});
  console.log(`${wfs.length} workflow(s) in the system database:\n`);
  for (const w of wfs) {
    const secs = w.updatedAt ? ((w.updatedAt - w.createdAt) / 1000).toFixed(1) : "?";
    console.log(`  ${w.workflowID.padEnd(38)} ${w.status.padEnd(9)} ${secs}s  ${w.workflowName}`);
  }
  console.log(`\nRun again with a workflow id to see its steps.`);
} else {
  const status = await DBOS.getWorkflowStatus(wfId);
  const steps = (await DBOS.listWorkflowSteps(wfId)) ?? [];
  console.log(`workflow ${wfId} — ${status?.status}\n`);
  console.log(`  ${"#".padEnd(4)}${"step".padEnd(34)}${"ms".padEnd(7)}output`);
  let prevEnd: number | undefined;
  for (const s of steps) {
    // A long silence between two steps is the crash: the process was gone and
    // the workflow sat in Postgres until something launched and recovered it.
    if (prevEnd && s.startedAtEpochMs && s.startedAtEpochMs - prevEnd > 5000) {
      const gap = ((s.startedAtEpochMs - prevEnd) / 1000).toFixed(1);
      console.log(`  ---- ${gap}s gap: the process was dead here; ` +
                  `everything above was replayed from Postgres ----`);
    }
    const ms = s.completedAtEpochMs && s.startedAtEpochMs
      ? String(s.completedAtEpochMs - s.startedAtEpochMs) : "-";
    const out = s.error ? `ERROR ${s.error}` : JSON.stringify(s.output ?? null);
    console.log(`  ${String(s.functionID).padEnd(4)}${s.name.slice(0, 32).padEnd(34)}` +
                `${ms.padEnd(7)}${(out ?? "").slice(0, 60)}`);
    prevEnd = s.completedAtEpochMs ?? prevEnd;
  }
  console.log(`\n  ${steps.length} steps recorded. On replay, every one of these is ` +
              `returned from Postgres instead of being executed again.`);
}
await DBOS.shutdown();
