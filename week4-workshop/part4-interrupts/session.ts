// session.ts — Part 4: cancellation that does not corrupt the conversation.
//
// The naive Ctrl+C is `process.exit()`. The naive-but-worse Ctrl+C throws away
// the half-finished turn and leaves `messages` ending on a user message with
// no reply — so the next turn re-answers the abandoned question, or the model
// gets a transcript that never happened in the real world.
//
// The rule: whatever was actually shown to the user is part of history.
// The user read those tokens. The model must know it said them.
import { isAbort, streamTurn, SYSTEM_PROMPT, type Msg } from "./model.js";

export interface TurnHandlers {
  onDelta?: (text: string) => void;
  onFirstToken?: (ms: number) => void;
}

export interface TurnResult {
  text: string;
  interrupted: boolean;
  ms: number;
}

export class Session {
  readonly messages: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }];

  /** The controller for the turn in flight, or null when idle. */
  private inflight: AbortController | null = null;

  get busy(): boolean {
    return this.inflight !== null;
  }

  /** Cancel the turn in flight. Safe to call when idle — it does nothing. */
  interrupt(): boolean {
    if (!this.inflight) return false;
    this.inflight.abort();
    return true;
  }

  async send(input: string, handlers: TurnHandlers = {}): Promise<TurnResult> {
    if (this.inflight) throw new Error("a turn is already running");

    this.messages.push({ role: "user", content: input });

    const controller = new AbortController();
    this.inflight = controller;

    const started = Date.now();
    let first = true;
    let text = "";
    let interrupted = false;

    try {
      for await (const delta of streamTurn(this.messages, controller.signal)) {
        if (first) {
          first = false;
          handlers.onFirstToken?.(Date.now() - started);
        }
        text += delta;
        handlers.onDelta?.(delta);
      }
    } catch (err) {
      if (!isAbort(err)) {
        this.messages.pop();        // no reply happened at all — drop the user turn
        this.inflight = null;
        throw err;
      }
      interrupted = true;
    } finally {
      this.inflight = null;
    }

    // Do not rely on an exception to tell you the turn was cancelled. Some
    // clients throw an abort error; others simply stop iterating and let the
    // loop end normally. The signal is the one source of truth that is true
    // in both cases.
    if (controller.signal.aborted) interrupted = true;

    // Commit whatever the user actually saw. An interrupted turn is a real
    // turn: annotate it so the model knows the thought was cut off rather
    // than finished, and so /clear-less recovery reads correctly.
    if (interrupted) {
      this.messages.push({
        role: "assistant",
        content: text
          ? `${text}\n\n[interrupted by the user before finishing]`
          : "[interrupted by the user before answering]",
      });
    } else {
      this.messages.push({ role: "assistant", content: text });
    }

    return { text, interrupted, ms: Date.now() - started };
  }
}
