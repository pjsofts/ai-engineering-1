// model.ts — Part 2: the same call with `stream: true`.
//
// Non-streaming: one HTTP response, delivered when the model has finished.
// Streaming:     one HTTP response held open, delivering server-sent events,
//                each carrying a few characters, as the model produces them.
//
// Same model, same cost, same final text. The only thing that changes is WHEN
// you are allowed to see it — and that is the whole difference between an app
// that feels dead and one that feels alive.
import OpenAI from "openai";

export type Msg = OpenAI.Chat.ChatCompletionMessageParam;

export const MODEL = process.env.MODEL ?? "gpt-4o-mini";

export const SYSTEM_PROMPT =
  "You are mycode, a terminal coding assistant. Be concise and concrete. " +
  "Prefer short paragraphs and small code blocks over long essays.";

const client = new OpenAI();

/** An async generator of text deltas. `for await` reads it one chunk at a time. */
export async function* streamTurn(messages: Msg[]): AsyncGenerator<string> {
  const stream = await client.chat.completions.create({
    model: MODEL,
    messages,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
