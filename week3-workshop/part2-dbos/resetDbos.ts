// resetDbos.ts — clear the slate between demos: cancel every workflow still
// PENDING (or ENQUEUED) so the next launch doesn't resume yesterday's run.
// Cancelled workflows stay in the system database as history — DBOS never
// deletes your receipts, it just stops replaying them.
import { DBOS } from "@dbos-inc/dbos-sdk";
import { launch } from "./harness.js";

await launch();
const stuck = (await DBOS.listWorkflows({}))
  .filter((w) => w.status === "PENDING" || w.status === "ENQUEUED");
for (const w of stuck) {
  await DBOS.cancelWorkflow(w.workflowID);
  console.log(`cancelled ${w.workflowID} (was ${w.status})`);
}
console.log(stuck.length ? `${stuck.length} workflow(s) cancelled.` : "nothing pending.");
await DBOS.shutdown();
