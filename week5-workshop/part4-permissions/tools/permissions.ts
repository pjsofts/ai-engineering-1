// tools/permissions.ts — the gate between a language model and your machine.
//
// You have just handed an LLM a shell. Without this file, "clean up the temp
// files" can become an `rm -rf` in the wrong directory, and "reset my branch"
// can throw away a day's work. The permission system is the adult in the room.
//
// Every tool call is classified into exactly one of three outcomes:
//
//   ALLOW — read-only tools. They cannot change anything, so they never ask.
//           This set IS your trust boundary: keep it small and obviously safe.
//   DENY  — a short list of catastrophes, refused outright. This is a backstop,
//           not security: it means an obvious disaster needs a human to
//           deliberately override it, not that the list is complete.
//   ASK   — everything else. Show the user exactly what will happen, and wait.
//
// The ladder is the design. Deny rules are checked before ask rules, ask rules
// before allow rules, and anything unrecognised falls through to ASK — the
// system FAILS CLOSED. A permission system that fails open is decoration.

/** Read-only tools never need to ask. This set is the trust boundary. */
export const SAFE_TOOLS = new Set(["read_file", "glob_files", "grep_search"]);

/**
 * Shell commands matching any of these are denied outright, always, even if the
 * user has said "always allow" for that program. These are the operations where
 * a mistake is not recoverable by ctrl-Z or a git checkout.
 */
const DANGEROUS: [RegExp, string][] = [
  [/\brm\s+-[a-z]*[rf]/i, "recursive or forced delete"],
  [/:\s*\(\s*\)\s*\{/, "fork bomb"],
  [/\bgit\s+push\b[^\n]*--force/i, "force push"],
  [/\bgit\s+reset\b[^\n]*--hard/i, "hard reset — discards uncommitted work"],
  [/\bsudo\b/, "sudo"],
  [/>\s*\/dev\/(sd|nvme|disk)/i, "writing to a raw device"],
  [/\bmkfs\b/i, "formatting a filesystem"],
  [/\bdd\s+if=/i, "dd"],
  [/curl[^|]*\|\s*(sudo\s+)?(ba)?sh/i, "piping a download into a shell"],
  [/\bchmod\s+-R\s+777/i, "recursive chmod 777"],
];

export type Decision = "allow" | "ask" | "deny";
export const ALLOW = "allow" as const;
export const ASK = "ask" as const;
export const DENY = "deny" as const;

/** What the user is being asked to approve, in their words rather than JSON. */
export interface Verdict {
  decision: Decision;
  why: string;
}

/**
 * The allowlist grows when the user answers "always". It holds two shapes of
 * key: a bare tool name ("edit_file") and a bash command prefix
 * ("run_bash:npm"). Per-program is the right granularity for a shell — saying
 * "always" to `npm test` should not also approve `curl`.
 */
export type Allowlist = Set<string>;

export function allowKey(tool: string, args: Record<string, any>): string {
  if (tool !== "run_bash") return tool;
  const program = String(args.command ?? "").trim().split(/\s+/)[0] ?? "";
  return `run_bash:${program}`;
}

export function classify(
  tool: string,
  args: Record<string, any>,
  allowlist: Allowlist,
): Verdict {
  if (SAFE_TOOLS.has(tool)) return { decision: ALLOW, why: "read-only" };

  if (tool === "run_bash") {
    const command = String(args.command ?? "");
    // Deny first. A denied pattern is never overridable by the allowlist —
    // that ordering is the whole reason to write the ladder in this direction.
    for (const [pattern, label] of DANGEROUS) {
      if (pattern.test(command)) return { decision: DENY, why: label };
    }
    const key = allowKey(tool, args);
    if (allowlist.has(key)) return { decision: ALLOW, why: `allowlisted: ${key.slice(9)}` };
    return { decision: ASK, why: args.reason ? String(args.reason) : "run a shell command" };
  }

  if (allowlist.has(tool)) return { decision: ALLOW, why: "allowlisted" };

  // Anything we do not recognise — including a tool added next month by someone
  // who never read this file — asks. Fail closed.
  return { decision: ASK, why: tool === "edit_file" ? "modify a file" : "write to disk" };
}
