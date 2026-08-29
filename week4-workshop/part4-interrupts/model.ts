// model.ts — Part 4: the same stream, now cancellable.
//
// AbortSignal is the standard cancellation currency of the web platform, and
// Node speaks it too. One signal, passed down, cancels the HTTP request at the
// socket. Not "ignore the result when it arrives" — the request is actually
// torn down, and you stop being billed for tokens you never see.
import OpenAI from "openai";

export type Msg = OpenAI.Chat.ChatCompletionMessageParam;

export const MODEL = process.env.MODEL ?? "gpt-4o-mini";

export const SYSTEM_PROMPT =
  "You are mycode, a terminal coding assistant. Be concise and concrete. " +
  "Prefer short paragraphs and small code blocks over long essays.";

const client = new OpenAI();

/** True when an error is "the user cancelled", not "something broke". */
export function isAbort(err: unknown): boolean {
  return (
    err instanceof OpenAI.APIUserAbortError ||
    (err as { name?: string })?.name === "AbortError"
  );
}

export async function* streamTurn(
  messages: Msg[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const stream = await client.chat.completions.create(
    { model: MODEL, messages, stream: true },
    { signal },                       // ← the whole feature, in one option
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
