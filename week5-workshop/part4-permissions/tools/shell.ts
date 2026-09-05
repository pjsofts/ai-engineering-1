// tools/shell.ts — run_bash. The most powerful tool you own and the easiest to
// get killed by.
//
// Three rules keep it survivable, and each one maps to a specific way a live
// demo dies:
//
//   always a timeout — the model runs `npm run dev`, the server never exits,
//                      and your agent hangs forever with a spinner on screen.
//   always a cap     — a command that prints two million lines should not be
//                      allowed to spend your entire context window. We keep the
//                      head AND the tail, because errors live at the ends: the
//                      command that failed is at the start, the stack trace is
//                      at the end, and the middle is usually noise.
//   never a crash    — a non-zero exit code and a page of stderr are exactly
//                      the information the model needs to fix its next move.
//                      Return them as data. An exception ends the loop; an
//                      error message continues it.
import { spawnSync } from "node:child_process";

const MAX_OUT = 30_000;      // characters of combined stdout+stderr
const DEFAULT_TIMEOUT = 120; // seconds
const MAX_TIMEOUT = 600;

export interface BashArgs {
  command: string;
  /** Why the model wants to run it. Shown to the human in the permission prompt. */
  reason?: string;
  timeout_s?: number;
}

export function runBash({ command, timeout_s = DEFAULT_TIMEOUT }: BashArgs): string {
  const seconds = Math.min(timeout_s || DEFAULT_TIMEOUT, MAX_TIMEOUT);

  const r = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    timeout: seconds * 1000,
    maxBuffer: 10 * 1024 * 1024,
  });

  // A killed-by-timeout process reports SIGTERM here. Say so plainly, and tell
  // the model what to do differently — an error message is a second prompt.
  if (r.error?.message?.includes("ETIMEDOUT") || r.signal === "SIGTERM") {
    return `<tool_error>timed out after ${seconds}s. If this is a server, a ` +
      `watcher or an interactive prompt it will never exit — do not run it here. ` +
      `Run the one-shot version instead.</tool_error>`;
  }
  if (r.error) return `<tool_error>could not run: ${r.error.message}</tool_error>`;

  let out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (out.length > MAX_OUT) {
    const half = Math.floor(MAX_OUT / 2);
    out = `${out.slice(0, half)}\n… [output trimmed] …\n${out.slice(-half)}`;
  }
  // Never return an empty string: a model reading "" tends to assume the tool
  // is broken and run the command again.
  if (!out) out = "(command completed with no output)";

  return `exit code: ${r.status ?? "killed"}\n${out}`;
}
