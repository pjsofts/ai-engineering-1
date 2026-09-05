// smoke.ts — does this thing actually work?
//
// Two tiers, and the split matters more than the assertions:
//
//   GUARDS  — deterministic, free, offline. Every guard in edit.ts and every
//             branch of classify() is a pure function of its inputs, so it can
//             be tested like ordinary code. This is most of your safety story,
//             and it should never need an API key. `npm run guards`.
//   LIVE    — one real agent run against the API. Slow, costs a fraction of a
//             cent, and non-deterministic — so it asserts on OUTCOMES (the bug
//             is fixed, the tests pass, nothing ran without approval) and never
//             on the exact sequence of tool calls the model chose.
//
// Run:  npm run smoke     (both tiers, from the workshop root)
//       npm run guards    (tier 1 only — no network, no key)
//
// Both start in sandbox/, a fresh copy of fixture/.
import fs from "node:fs";
import { readFile, READ_STATE, writeFile } from "./tools/fs.js";
import { editFile } from "./tools/edit.js";
import { runBash } from "./tools/shell.js";
import { globFiles, grepSearch } from "./tools/search.js";
import { classify } from "./tools/permissions.js";
import { Session, type Approval, type ApprovalRequest } from "./session.js";
import { formatUSD } from "./cost.js";

const guardsOnly = process.argv.includes("--guards-only");

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ✔" : "  ✘"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
}
const errored = (s: string) => s.startsWith("<tool_error>");

console.log("\n  tier 1 — guards (no network)\n");

// --- read_file --------------------------------------------------------------
check("read_file numbers its lines", readFile({ path: "utils.ts" }).includes("    1| "));
check("read_file honours offset/limit",
  readFile({ path: "utils.ts", offset: 2, limit: 1 }).split("\n")[0].startsWith("    2|"));
check("read_file reports a missing file as data", errored(readFile({ path: "nope.ts" })));
check("read_file arms READ_STATE", READ_STATE.has("utils.ts"));

// --- write_file -------------------------------------------------------------
check("write_file creates a new file", writeFile({ path: "tmp/new.txt", content: "hi" })
  .startsWith("created"));
READ_STATE.delete("tmp/new.txt");
check("write_file refuses to overwrite an unread file",
  errored(writeFile({ path: "tmp/new.txt", content: "clobbered" })));
check("… and the file survived", fs.readFileSync("tmp/new.txt", "utf8") === "hi");
readFile({ path: "tmp/new.txt" });
check("… but overwrites once it has been read",
  writeFile({ path: "tmp/new.txt", content: "ok" }).startsWith("overwrote"));

// --- edit_file: one test per guard -----------------------------------------
check("guard 1 — identical strings",
  errored(editFile({ path: "utils.ts", old_string: "x", new_string: "x" })));
check("guard 2 — missing file",
  errored(editFile({ path: "nope.ts", old_string: "a", new_string: "b" })));

READ_STATE.delete("utils.ts");
check("guard 3 — not read yet",
  errored(editFile({ path: "utils.ts", old_string: "let total = 0;", new_string: "let total = 1;" })));

readFile({ path: "utils.ts" });
READ_STATE.set("utils.ts", 0);                      // pretend we read it in 1970
check("guard 4 — changed on disk since the read",
  errored(editFile({ path: "utils.ts", old_string: "let total = 0;", new_string: "let total = 1;" })));

readFile({ path: "utils.ts" });
check("guard 5 — old_string not found",
  errored(editFile({ path: "utils.ts", old_string: "not in the file", new_string: "x" })));
check("guard 6 — old_string is ambiguous",
  errored(editFile({ path: "utils.ts", old_string: "total", new_string: "sum" })));

const edit = editFile({
  path: "utils.ts",
  old_string: "  let total = 0;",
  new_string: "  let total = 0; // edited by the guard test",
});
check("a unique, current, read file edits cleanly", edit === "edited utils.ts");
check("… and consecutive edits are still legal", editFile({
  path: "utils.ts",
  old_string: " // edited by the guard test",
  new_string: "",
}) === "edited utils.ts");

// --- run_bash ---------------------------------------------------------------
check("run_bash reports the exit code", runBash({ command: "echo hi" }).startsWith("exit code: 0"));
check("run_bash returns a failure as data, not an exception",
  runBash({ command: "exit 3" }).startsWith("exit code: 3"));
check("run_bash never returns empty", runBash({ command: "true" }).includes("no output"));
check("run_bash times out rather than hanging",
  errored(runBash({ command: "sleep 5", timeout_s: 1 })));

// --- glob & grep ------------------------------------------------------------
check("glob_files finds by pattern", globFiles({ pattern: "*.ts" }).includes("utils.ts"));
check("glob_files says so when nothing matches",
  globFiles({ pattern: "*.rs" }) === "(no matches)");
check("grep_search returns file:line:", grepSearch({ pattern: "parseDuration" }).includes("utils.ts:"));
check("grep_search reports a bad regex as data", errored(grepSearch({ pattern: "([" })));

// --- the permission ladder --------------------------------------------------
const empty = new Set<string>();
check("read-only tools are allowed", classify("read_file", { path: "a" }, empty).decision === "allow");
check("rm -rf is denied", classify("run_bash", { command: "rm -rf ~/projects" }, empty).decision === "deny");
check("a force push is denied",
  classify("run_bash", { command: "git push origin main --force" }, empty).decision === "deny");
check("an ordinary command asks", classify("run_bash", { command: "npm test" }, empty).decision === "ask");
check("an allowlisted program does not ask",
  classify("run_bash", { command: "npm test" }, new Set(["run_bash:npm"])).decision === "allow");
check("… but the allowlist cannot override a denial",
  classify("run_bash", { command: "sudo rm -rf /" }, new Set(["run_bash:sudo"])).decision === "deny");
check("edit_file asks", classify("edit_file", { path: "a" }, empty).decision === "ask");
check("an unknown tool fails closed", classify("some_new_tool", {}, empty).decision === "ask");

fs.rmSync("tmp", { recursive: true, force: true });

if (guardsOnly) {
  console.log(`\n  ${failures ? `${failures} failed` : "all guards passed"}\n`);
  process.exit(failures ? 1 : 0);
}

// ---------------------------------------------------------------------------
console.log("\n  tier 2 — one live agent run\n");

// Put the bug back: the guard tests above have been editing this file.
fs.copyFileSync("../fixture/utils.ts", "utils.ts");
READ_STATE.clear();

// A scripted human. Approving everything is the interesting case to automate;
// the denial path gets its own turn below.
const approvals: ApprovalRequest[] = [];
const approveAll = async (req: ApprovalRequest): Promise<Approval> => {
  approvals.push(req);
  return "yes";
};

const session = new Session();
const turn = await session.send(
  "The test in utils.test.ts fails. Run it with " +
  "`node --test --experimental-strip-types utils.test.ts`, fix the bug in utils.ts, " +
  "and run the test again to prove it passes.",
  { approve: approveAll },
);

const names = turn.tools.map((t) => t.name);
console.log(`    ${names.join(" → ")}\n`);

check("the agent took several steps", turn.steps > 1, `${turn.steps} steps`);
check("it stayed inside the step limit", !turn.hitStepLimit);
check("it used tools", turn.tools.length > 0, `${turn.tools.length} calls`);
check("it read before it edited",
  !names.includes("edit_file") || names.indexOf("read_file") < names.indexOf("edit_file"));
check("every write and command was approved by the human",
  turn.tools.filter((t) => t.decision === "ask").length === approvals.length);
check("read-only calls were never sent for approval",
  !approvals.some((a) => ["read_file", "glob_files", "grep_search"].includes(a.name)));
check("the bug is actually fixed",
  fs.readFileSync("utils.ts", "utf8").includes("3600"));

const verify = runBash({ command: "node --test --experimental-strip-types utils.test.ts" });
check("the test suite passes now", verify.startsWith("exit code: 0"),
  verify.split("\n").find((l) => l.includes("pass")) ?? "");

// --- the denial path --------------------------------------------------------
// A denied call must reach the model as a RESULT, so the loop keeps going and
// the agent explains itself rather than crashing or silently proceeding.
const denials: ApprovalRequest[] = [];
const denyAll = async (req: ApprovalRequest): Promise<Approval> => {
  denials.push(req);
  return "no";
};
const before = fs.readFileSync("utils.ts", "utf8");
const denied = await session.send(
  "Now delete the parseDuration function from utils.ts entirely.",
  { approve: denyAll },
);
check("the denied turn still finished", !denied.interrupted && denied.text.length > 0);
check("the human was asked", denials.length > 0, `${denials.length} request(s)`);
check("nothing changed on disk", fs.readFileSync("utils.ts", "utf8") === before);
check("the denial reached the model as a tool result",
  denied.tools.every((t) => t.decision !== "ask" || t.result.includes("denied")));

console.log(`\n  ${session.meter.turns} turn(s) · ${formatUSD(session.meter.totalUSD)}`);
console.log(`  ${failures ? `${failures} FAILED` : "all checks passed"}\n`);
process.exit(failures ? 1 : 0);
