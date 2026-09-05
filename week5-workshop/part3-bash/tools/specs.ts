// tools/specs.ts — the six tools, as the model sees them.
//
// The model never sees your code. It sees this file: a name, a paragraph of
// prose that says WHEN to reach for the tool, and a strict JSON schema of the
// arguments. That is the entire user manual it gets.
//
// So: ninety percent of "the model uses my tools badly" is really "my tool
// descriptions are vague". When a tool is misused, fix the description before
// you touch the code. You are writing documentation for a reader that follows
// it literally and never asks a follow-up question.
//
// Part 2 adds the two tools that CHANGE things. Notice how much of the safety
// story lives in the prose: edit_file's description tells the model to read
// first and to make old_string unique, so that most of the time the guards in
// edit.ts never have to fire. Guards catch the model; descriptions teach it.
import type OpenAI from "openai";

export type ToolSpec = OpenAI.Chat.Completions.ChatCompletionTool;

/**
 * `additionalProperties: false` plus an explicit `required` list is what stops
 * the model inventing fields. Without it you will eventually receive
 * `{"path": "a.ts", "encoding": "utf-8"}` and crash on a parameter you never
 * declared.
 */
export function spec(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): ToolSpec {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required, additionalProperties: false },
    },
  };
}

export const TOOL_SPECS: ToolSpec[] = [
  spec("read_file",
    "Read a file from the project. Returns numbered lines. " +
    "Use it before any edit — edit_file refuses to touch a file you have not read.",
    {
      path: { type: "string", description: "path relative to the project root" },
      offset: { type: "integer", description: "1-based first line to return" },
      limit: { type: "integer", description: "max lines to return, default 2000" },
    },
    ["path"]),

  spec("write_file",
    "Create a file, or completely overwrite an existing one. For a change to " +
    "part of an existing file prefer edit_file — a full rewrite costs more and " +
    "risks dropping code you did not mean to touch. You may not overwrite a " +
    "file you have not read.",
    { path: { type: "string" }, content: { type: "string" } },
    ["path", "content"]),

  spec("edit_file",
    "Replace an exact string in a file. old_string must appear EXACTLY once — " +
    "include the surrounding lines to make it unique — and must match the file " +
    "character for character, including indentation. Read the file first.",
    {
      path: { type: "string" },
      old_string: { type: "string", description: "text to find, verbatim" },
      new_string: { type: "string", description: "text to put in its place" },
    },
    ["path", "old_string", "new_string"]),

  spec("run_bash",
    "Run a shell command in the project directory and return its output. " +
    "Use it to run tests, build, install, or inspect the environment. " +
    "Explain WHY in `reason` — the user sees it before approving. " +
    "Prefer read_file / grep_search / glob_files over cat, grep and find: they " +
    "are capped and cheaper. Never start a server, watcher or anything that " +
    "does not exit on its own.",
    {
      command: { type: "string" },
      reason: { type: "string", description: "one short line: why this command" },
      timeout_s: { type: "integer", description: "default 120, max 600" },
    },
    ["command", "reason"]),

  spec("glob_files",
    "Find files by name pattern, e.g. '**/*.ts' or 'src/*.json'. " +
    "Newest-modified first, max 100 results. Use this instead of `find` in a shell.",
    { pattern: { type: "string" } },
    ["pattern"]),

  spec("grep_search",
    "Search file CONTENTS with a regular expression. Returns matching lines as " +
    "file:line: text. Use this instead of running `grep` through a shell — it is " +
    "capped, sorted and cheaper in context.",
    {
      pattern: { type: "string", description: "a JavaScript regular expression" },
      glob: { type: "string", description: "limit to matching filenames, e.g. '*.ts'" },
    },
    ["pattern"]),
];
