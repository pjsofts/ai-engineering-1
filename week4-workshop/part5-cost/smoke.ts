// smoke.ts — a non-interactive check that the core works, without a terminal.
//
// This file exists to make a point as much as to test: everything below drives
// Session directly. No readline, no ANSI, no keyboard. If the core needed the
// terminal, this file would be impossible to write.
//
// Run:  npm run smoke
import { Session } from "./session.js";
import { formatUSD } from "./cost.js";
import { dispatch } from "./commands.js";

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ✔" : "  ✘"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

const s = new Session();

// --- 1. a normal streamed turn ------------------------------------------
let deltas = 0;
const t1 = await s.send("Reply with exactly: ready", { onDelta: () => deltas++ });
check("streamed in multiple chunks", deltas > 0, `${deltas} deltas`);
check("returned text", t1.text.length > 0, JSON.stringify(t1.text.slice(0, 40)));
check("reported usage", t1.usage.output > 0,
  `${t1.usage.input} in / ${t1.usage.output} out`);
check("priced the turn", s.meter.totalUSD > 0, formatUSD(s.meter.totalUSD));
check("history is user→assistant", s.messages.map((m) => m.role).join(",") ===
  "system,user,assistant");

// --- 2. local and render commands never touch the network ----------------
const ctx = { messages: s.messages, meter: s.meter, quit: () => {} };
const spentBefore = s.meter.totalUSD;
check("/help is handled locally", dispatch("/help", ctx)?.type === "handled");
check("/cost is handled locally", dispatch("/cost", ctx)?.type === "handled");
check("/review expands to a prompt", dispatch("/review a.ts", ctx)?.type === "prompt");
check("/nope is unknown", dispatch("/nope", ctx)?.type === "unknown");
check("plain text is not a command", dispatch("hello", ctx) === null);
check("commands cost nothing", s.meter.totalUSD === spentBefore);

// --- 3. interruption keeps history coherent ------------------------------
// Anchor the interrupt to the first token, not to the wall clock — otherwise
// a slow TTFT means we cancel before anything has streamed and the test is
// measuring the network rather than the cancellation logic.
const t2 = await s.send("Write 400 words about the history of the semicolon.", {
  onFirstToken: () => setTimeout(() => s.interrupt(), 500),
});
check("turn was interrupted", t2.interrupted);
check("partial text was kept", t2.text.length > 0, `${t2.text.length} chars`);
check("marked as interrupted in history",
  String(s.messages.at(-1)!.content).includes("[interrupted"));
check("session is idle again", !s.busy);
check("interrupted output was still billed", t2.usage.output > 0);

// --- 4. /clear keeps the system prompt -----------------------------------
dispatch("/clear", ctx);
check("/clear leaves only the system prompt", s.messages.length === 1 &&
  s.messages[0].role === "system");

console.log(`\n  session cost: ${formatUSD(s.meter.totalUSD)} over ${s.meter.turns} turns\n`);
