// tools/search.ts — glob_files and grep_search, written by hand.
//
// The model has to FIND things before it can change them, and "find" comes in
// two flavours: by filename and by content. Neither implementation is clever.
// The two decisions that actually matter are:
//
//   ordering — newest-modified first. The file you touched five minutes ago is
//              far likelier to be the one in question than one untouched for a
//              year. Relevance ranking for free.
//   caps     — 100 files, 250 matching lines. Not laziness: context-budget
//              policy. Enough for the model to see the shape of the answer,
//              small enough that you can afford to send it every turn.
import fs from "node:fs";
import path from "node:path";

const SKIP = new Set([".git", "node_modules", "__pycache__", ".venv", "dist", "build", ".next"]);
const MAX_FILES = 100;
const MAX_HITS = 250;

/** Depth-first walk that never descends into the directories nobody means. */
export function* walk(root = "."): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return; // unreadable directory is not a crash
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(root, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p.replace(/^\.\//, "");
  }
}

/**
 * Translate a glob into a regex.
 *
 * Order matters, and this is the bug everyone writes once: the `**` case has to
 * be handled BEFORE the single `*`, or the first star eats the second one and
 * a pattern like `**` + `/*.ts` silently stops matching subdirectories. We
 * park it on a placeholder character first, then substitute at the end.
 */
function globToRegExp(pattern: string): RegExp {
  const rx = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**/", "\u0001")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0001", "(?:.*/)?");
  return new RegExp(`^${rx}$`);
}

export function globFiles({ pattern }: { pattern: string }): string {
  const rx = globToRegExp(pattern);
  const hits = [...walk()]
    .filter((p) => rx.test(p))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs); // newest first
  if (!hits.length) return "(no matches)";
  const shown = hits.slice(0, MAX_FILES);
  const more = hits.length > MAX_FILES
    ? `\n… ${hits.length - MAX_FILES} more (narrow the pattern)`
    : "";
  return shown.join("\n") + more;
}

export function grepSearch({ pattern, glob = "*" }: { pattern: string; glob?: string }): string {
  let rx: RegExp;
  // A bad regex from the model is a tool error, not a crash. Tell it what broke
  // and it will fix the pattern on its next call.
  try {
    rx = new RegExp(pattern);
  } catch (err) {
    return `<tool_error>invalid regex: ${(err as Error).message}</tool_error>`;
  }

  const fileRx = globToRegExp(glob);
  const out: string[] = [];
  for (const p of walk()) {
    if (!fileRx.test(path.basename(p)) && !fileRx.test(p)) continue;
    let text: string;
    try {
      text = fs.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue; // binary file: skip it
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!rx.test(lines[i])) continue;
      out.push(`${p}:${i + 1}: ${lines[i].slice(0, 200)}`);
      if (out.length >= MAX_HITS) {
        out.push(`… [${MAX_HITS}-hit limit] narrow your pattern or pass a glob`);
        return out.join("\n");
      }
    }
  }
  return out.length ? out.join("\n") : "(no matches)";
}
