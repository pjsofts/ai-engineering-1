// inspectLog.ts — prove the durability claims from the terminal. How many
// times was each tool call REQUESTED? More than once means a side effect was
// repeated — the exact bug durable execution exists to kill.
import fs from "node:fs";
if (process.argv.includes("truncate")) {
  fs.writeFileSync("events.jsonl", "");
  console.log("events.jsonl truncated.");
  process.exit(0);
}
interface LogEvent { type: string; call?: string; [key: string]: unknown }
const events: LogEvent[] = fs.readFileSync("events.jsonl", "utf8")
  .split("\n").filter(Boolean).map((line) => JSON.parse(line));
const byType: Record<string, number> = {}, reqByCall: Record<string, number> = {};
for (const e of events) {
  byType[e.type] = (byType[e.type] ?? 0) + 1;
  if (e.type === "tool.requested" && e.call) reqByCall[e.call] = (reqByCall[e.call] ?? 0) + 1;
}
const duplicated = Object.entries(reqByCall).filter(([, n]) => n > 1);
console.log("total events:       ", events.length);
console.log("by type:            ", byType);
console.log("distinct tool calls:", Object.keys(reqByCall).length);
console.log("DUPLICATED calls:   ", duplicated.length, duplicated);
console.log("completed:          ", byType["workflow.completed"] ?? 0);
