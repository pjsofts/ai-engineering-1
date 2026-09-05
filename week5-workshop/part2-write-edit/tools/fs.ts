// tools/fs.ts — read_file, and the invisible star of the whole week: READ_STATE.
//
// READ_STATE is a map of "which files have we read, and what was the file's
// modification time at that moment". read_file arms it. In Part 2, write_file
// and edit_file check it, and that one check is the difference between an agent
// that edits your code and an agent that overwrites your code with a plausible
// hallucination of what it probably said.
//
// It lives here rather than inside edit.ts because it is shared state between
// two tools — the classic shape of a safety interlock.
import fs from "node:fs";
import path from "node:path";

/** path -> mtimeMs at the moment we last read (or wrote) it. */
export const READ_STATE = new Map<string, number>();

const MAX_LINES = 2000;
const MAX_BYTES = 262_144; // 256 KB

export interface ReadArgs {
  path: string;
  offset?: number;
  limit?: number;
}

export function readFile({ path: p, offset = 1, limit = MAX_LINES }: ReadArgs): string {
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
    return `<tool_error>not found: ${p}</tool_error>`;
  }
  // An error beats a truncation. Anthropic ran this as an actual A/B test on
  // the real Read tool: silently truncating a huge file lowered the error rate
  // but raised mean token usage — a 100-byte error is cheaper than 25,000
  // tokens of content nobody asked for. They kept the error. So do we.
  if (fs.statSync(p).size > MAX_BYTES) {
    return `<tool_error>${p} is larger than 256KB. Read a slice with ` +
      `offset/limit, or grep_search it instead.</tool_error>`;
  }

  const lines = fs.readFileSync(p, "utf8").split("\n");
  READ_STATE.set(p, fs.statSync(p).mtimeMs); // arm the edit gate

  // A bare empty result makes models behave strangely — they tend to assume the
  // tool failed and call it again. Say something instead of nothing.
  if (lines.length === 1 && lines[0] === "") return "<note>file exists but is empty</note>";

  const start = Math.max(1, offset) - 1;
  const window = lines.slice(start, start + limit);
  // Numbered lines, `cat -n` style, so the model can say "line 15" and mean it.
  const body = window.map((l, i) => `${String(start + i + 1).padStart(5)}| ${l}`).join("\n");
  const rest = lines.length - start - window.length;
  return body + (rest > 0 ? `\n… ${rest} more lines (use offset to continue)` : "");
}

export interface WriteArgs { path: string; content: string }

/**
 * write_file — create a file, or overwrite one you have already read.
 *
 * The gate is the whole point. An LLM that overwrites a file it never looked at
 * will cheerfully delete your work based on a hallucinated memory of what the
 * file "probably" contained, and it will sound confident while doing it. The
 * rule sounds bureaucratic: you may not write a file you have not read. It is
 * the difference between a safe agent and a dangerous one.
 *
 * Creating a NEW file is exempt — there is nothing to destroy.
 */
export function writeFile({ path: p, content }: WriteArgs): string {
  const exists = fs.existsSync(p);
  if (exists && !READ_STATE.has(p)) {
    return "<tool_error>refusing to overwrite a file you have not read. " +
      "Call read_file on it first, so your write is based on what is actually " +
      "there rather than what you remember.</tool_error>";
  }
  const dir = path.dirname(p);
  if (dir) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, content);
  READ_STATE.set(p, fs.statSync(p).mtimeMs);   // we know the contents: re-arm
  return `${exists ? "overwrote" : "created"} ${p} (${content.length} chars)`;
}
