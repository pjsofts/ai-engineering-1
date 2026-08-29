// model.ts — Part 5: the stream now reports what it cost.
//
// With `stream: true` the usage block is normally omitted — the response is
// over before the totals are known. `stream_options: { include_usage: true }`
// asks for one final chunk, after the content, carrying the token counts.
// You must ask for it. Forget the flag and your meter silently reads zero.
import OpenAI from "openai";
import type { Usage } from "./cost.js";

export type Msg = OpenAI.Chat.ChatCompletionMessageParam;

export const MODEL = process.env.MODEL ?? "gpt-4o-mini";

export const SYSTEM_PROMPT =
  "You are mycode, a terminal coding assistant. Be concise and concrete. " +
  "Prefer short paragraphs and small code blocks over long essays.";

const client = new OpenAI();

export function isAbort(err: unknown): boolean {
  return (
    err instanceof OpenAI.APIUserAbortError ||
    (err as { name?: string })?.name === "AbortError"
  );
}

// A discriminated union instead of a bare string, because a stream now carries
// two kinds of news: text, and the bill.
export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "usage"; usage: Usage };

export async function* streamTurn(
  messages: Msg[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const stream = await client.chat.completions.create(
    {
      model: MODEL,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    },
    { signal },
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield { type: "delta", text: delta };

    if (chunk.usage) {
      const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
      yield {
        type: "usage",
        usage: {
          // prompt_tokens INCLUDES the cached ones — subtract, or you bill
          // the discounted tokens twice.
          input: chunk.usage.prompt_tokens - cached,
          cachedInput: cached,
          output: chunk.usage.completion_tokens,
        },
      };
    }
  }
}
