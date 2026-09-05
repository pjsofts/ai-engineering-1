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
// Part 1 defines the three READ-ONLY tools. They cannot damage anything, which
// is why we can wire the agent loop up and let it run without a permission
// system standing in the way. Parts 2 and 3 add the dangerous three.
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
