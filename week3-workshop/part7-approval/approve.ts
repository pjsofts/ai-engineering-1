// approve.ts — the human side of the loop. Record the verdict, flip the
// workflow back to runnable; the runner's recovery pass does the rest: replay
// flies through the cached steps and lands exactly on the gate.
import fs from "node:fs";
const [wfId, verdict] = process.argv.slice(2);   // npx tsx approve.ts 3f9c21aa yes
if (!wfId || !verdict) {
  console.log("usage: tsx approve.ts <workflow-id> yes|no");
  process.exit(1);
}
fs.mkdirSync("decisions", { recursive: true });
fs.writeFileSync(`decisions/${wfId}.json`,
  JSON.stringify({ approved: verdict === "yes" }));
const statePath = `wf/${wfId}.json`;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
state.status = "running";                        // wake it up
fs.writeFileSync(statePath, JSON.stringify(state));
console.log(`decision recorded for ${wfId} - run the harness to resume it.`);
