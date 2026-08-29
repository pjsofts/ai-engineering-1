// session.ts — mycode v0.1's core: streaming, cancellable, metered, and with
// no idea that terminals exist.
//
// week4-gui/ imports this file unchanged and draws it in a browser. If you can
// do that, the split between core and interface is real. If you cannot, you
// have a terminal program with an agent hidden inside it.
import { isAbort, MODEL, streamTurn, SYSTEM_PROMPT, type Msg } from "./model.js";
import { CostMeter, ZERO, type Usage } from "./cost.js";

export interface TurnHandlers {
  onDelta?: (text: string) => void;
  onFirstToken?: (ms: number) => void;
  onUsage?: (usage: Usage) => void;
}

export interface TurnResult {
  text: string;
  interrupted: boolean;
  ms: number;
  ttft: number;
  usage: Usage;
}

export class Session {
  readonly messages: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }];
  readonly meter = new CostMeter(MODEL);

  private inflight: AbortController | null = null;

  get busy(): boolean { return this.inflight !== null; }

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
    let ttft = 0;
    let first = true;
    let text = "";
    let interrupted = false;
    let usage: Usage = { ...ZERO };

    try {
      for await (const ev of streamTurn(this.messages, controller.signal)) {
        if (ev.type === "usage") {
          usage = ev.usage;
          handlers.onUsage?.(usage);
          continue;
        }
        if (first) {
          first = false;
          ttft = Date.now() - started;
          handlers.onFirstToken?.(ttft);
        }
        text += ev.text;
        handlers.onDelta?.(ev.text);
      }
    } catch (err) {
      if (!isAbort(err)) {
        this.messages.pop();
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

    // An interrupted stream never delivers its usage chunk, but the tokens
    // were still generated and are still billed. Estimating is honest;
    // reporting zero is not.
    if (interrupted && usage.output === 0) {
      usage = { ...ZERO, output: Math.ceil(text.length / 4) };
    }

    this.messages.push({
      role: "assistant",
      content: interrupted
        ? `${text || ""}\n\n[interrupted by the user before finishing]`.trim()
        : text,
    });

    this.meter.record(usage);
    return { text, interrupted, ms: Date.now() - started, ttft, usage };
  }
}
