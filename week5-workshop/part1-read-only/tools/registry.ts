// tools/registry.ts — name → implementation, plus the one function that runs a
// tool call safely.
//
// Keeping this separate from specs.ts is deliberate. specs.ts is what the MODEL
// sees; registry.ts is what YOU run. When the two drift — a spec for a tool
// that no longer exists, or a tool the model was never told about — you want a
// single obvious place where the mismatch shows up.
import { readFile } from "./fs.js";
import { globFiles, grepSearch } from "./search.js";

export type ToolFn = (args: any) => string | Promise<string>;

export const TOOLS: Record<string, ToolFn> = {
  read_file: readFile,
  glob_files: globFiles,
  grep_search: grepSearch,
};

/**
 * Run one tool call and ALWAYS return a string.
 *
 * Every failure below is returned as data rather than thrown, and that is the
 * central idea of the week: your tool's error message is a second prompt. A
 * good model reads "old_string appears 3 times" and fixes its next call. It
 * cannot read an exception, because an exception kills the loop it lives in.
 */
export async function runTool(name: string, rawArgs: string): Promise<string> {
  const fn = TOOLS[name];
  if (!fn) return `<tool_error>no such tool: ${name}</tool_error>`;

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch (err) {
    // Models do emit malformed JSON, especially when an argument contains code.
    // That is a tool error, not a crash.
    return `<tool_error>arguments were not valid JSON: ${(err as Error).message}</tool_error>`;
  }

  try {
    return await fn(args);
  } catch (err) {
    return `<tool_error>${name} failed: ${(err as Error).message}</tool_error>`;
  }
}
