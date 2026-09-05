// model.ts — the API call, and nothing else.
//
// Week 4's version streamed text and reported usage. Week 5 adds one thing: the
// stream can now also carry TOOL CALLS, and those arrive in fragments just like
// text does — the function name in one chunk, the JSON arguments a few
// characters at a time across many more.
//
// Reassembling them is the one piece of genuine protocol handling in the whole
// week, and `index` is the field that makes it possible: it says which call a
// fragment belongs to when the model asks for three things at once.
import OpenAI from "openai";
import type { Usage } from "./cost.js";
import type { ToolSpec } from "./tools/specs.js";

export type Msg = OpenAI.Chat.ChatCompletionMessageParam;

export const MODEL = process.env.MODEL ?? "gpt-4o-mini";

// The system prompt grows up.
//
// v0.1 said "you are a chat assistant". This is v0.2, and every line of it is
// there because of a specific failure mode observed in a live session:
//
//   read before edit      — the model editing its memory of a file
//   search tools not grep — `run_bash("grep -r foo .")`, uncapped, 40k tokens
//   edit over write       — a "small fix" that silently drops half the file
//   run the test          — "I've fixed it and the tests now pass" (untested)
//   small verified steps  — six edits in one turn, none of them checked
//   stop when done        — a model that keeps finding one more improvement
//
// A model with good tools and a bad working style thrashes. This paragraph is
// the difference between an eager intern and an engineer, and it costs about
// 150 tokens a turn. Week 6 is entirely about what belongs in here and what
// should be loaded on demand.
export const SYSTEM_PROMPT = `You are mycode, a coding agent working in the user's project directory.
You have tools: read_file, write_file, edit_file, run_bash, glob_files, grep_search.

How to work:
- Before editing a file, ALWAYS read_file it first. edit_file will refuse otherwise.
- To find things use grep_search and glob_files, never \`grep\` or \`find\` through run_bash.
- Prefer edit_file (a surgical change) over write_file (a full rewrite).
- After a change that can be tested, run the test with run_bash and read the output.
- Work in small verified steps: make one change, verify it, then make the next.
- When you are done, STOP and summarise what you changed and how you verified it.

Never claim a test passed without running it. If a tool returns <tool_error>, read
the message and fix your next call — do not repeat the call that just failed.
If the user denies a permission, do not ask again for the same thing: say what you
wanted to do and why, and offer an alternative.`;

// Constructed on first use, not at import: a module that throws merely because
// it was imported cannot be loaded by a test or a type checker.
let _client: OpenAI | null = null;
const client = (): OpenAI => (_client ??= new OpenAI());

export function isAbort(err: unknown): boolean {
  return (
    err instanceof OpenAI.APIUserAbortError ||
    (err as { name?: string })?.name === "AbortError"
  );
}

/** A tool call, reassembled from its fragments. `args` is still raw JSON text. */
export interface ToolCall {
  id: string;
  name: string;
  args: string;
}

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "usage"; usage: Usage }
  | { type: "calls"; calls: ToolCall[] };

/**
 * One model call. Yields text as it arrives, then — once the stream is over —
 * the tool calls it asked for, if any.
 *
 * Why the calls come at the end: an incomplete `{"path": "src/ap` is not
 * something you can act on. Text is useful half-finished; JSON arguments are
 * not, so we hold them until the stream closes.
 */
export async function* streamTurn(
  messages: Msg[],
  tools: ToolSpec[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const stream = await client().chat.completions.create(
    {
      model: MODEL,
      messages,
      tools,
      stream: true,
      stream_options: { include_usage: true },
    },
    { signal },
  );

  const partial: ToolCall[] = [];

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;

    if (delta?.content) yield { type: "delta", text: delta.content };

    for (const tc of delta?.tool_calls ?? []) {
      // `??=` because a fragment for index 2 can arrive before index 1 exists.
      const slot = (partial[tc.index] ??= { id: "", name: "", args: "" });
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name += tc.function.name;
      if (tc.function?.arguments) slot.args += tc.function.arguments;
    }

    if (chunk.usage) {
      const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
      yield {
        type: "usage",
        usage: {
          // prompt_tokens INCLUDES the cached ones. Subtract, or you bill the
          // discounted tokens at full price.
          input: chunk.usage.prompt_tokens - cached,
          cachedInput: cached,
          output: chunk.usage.completion_tokens,
        },
      };
    }
  }

  const calls = partial.filter(Boolean);
  if (calls.length) yield { type: "calls", calls };
}
