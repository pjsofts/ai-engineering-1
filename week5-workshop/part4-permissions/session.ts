// session.ts — the agent loop. This is the whole game.
//
// Week 4's Session sent a message and streamed a reply. That is a chatbot. The
// only structural change this week is the `for` loop below:
//
//     ask the model  →  did it request tools?
//         no  → done, return the text
//         yes → run each one, append every result, ask again
//
// Everything else in Week 5 — six tools, six guards, a permission gate — hangs
// off that loop. Two rules in it are absolute:
//
//   1. EVERY tool call gets a result. The API rejects a conversation that
//      contains an assistant message with tool_calls and no matching tool
//      messages. A denied call, a crashed call and an interrupted call all
//      still return something.
//   2. There is ALWAYS a step limit. An agent that can loop forever will,
//      eventually, on some input, at 3am, on your account.
//
// And, as in Week 4: no console.log, no readline, no DOM. The terminal in
// repl.ts and the browser in ../../week5-gui/ both drive this same class.
import { isAbort, MODEL, streamTurn, SYSTEM_PROMPT, type Msg } from "./model.js";
import { CostMeter, ZERO, type Usage } from "./cost.js";
import { TOOL_SPECS } from "./tools/specs.js";
import { runTool } from "./tools/registry.js";
import { allowKey, ASK, classify, DENY, type Allowlist, type Decision } from "./tools/permissions.js";

export const MAX_STEPS = 40;

/** One completed tool call, for the interface to draw as a receipt. */
export interface ToolRun {
  id: string;
  name: string;
  args: Record<string, any>;
  result: string;
  ms: number;
  /** What the gate decided, so the UI can show "auto" vs "you approved this". */
  decision: Decision;
  why: string;
}

/** What the interface is asked to put in front of a human. */
export interface ApprovalRequest {
  id: string;
  name: string;
  args: Record<string, any>;
  /** Plain-language reason this call needs a decision. */
  why: string;
}

export type Approval = "yes" | "always" | "no";

export interface TurnHandlers {
  onDelta?: (text: string) => void;
  onFirstToken?: (ms: number) => void;
  onUsage?: (usage: Usage) => void;
  /** A new model call is starting. `step` is 0-based. */
  onStep?: (step: number) => void;
  /** The model asked for a tool. Fires BEFORE it runs — this is the spinner. */
  onToolStart?: (call: { id: string; name: string; args: Record<string, any> }) => void;
  /** The tool finished. Fires with the receipt. */
  onToolEnd?: (run: ToolRun) => void;
  /**
   * Ask a human. The session BLOCKS on this promise, which is the point: the
   * agent stops until someone answers.
   *
   * A terminal implements it with readline; the browser implements it with a
   * dialog and a POST. The session does not care which — it only knows that
   * approval is somebody else's job. If no interface supplies this handler,
   * every ASK becomes a denial: fail closed.
   */
  approve?: (request: ApprovalRequest) => Promise<Approval>;
}

export interface TurnResult {
  text: string;
  interrupted: boolean;
  ms: number;
  ttft: number;
  usage: Usage;
  steps: number;
  tools: ToolRun[];
  /** True when the loop stopped because it ran out of steps, not because it finished. */
  hitStepLimit: boolean;
}

const add = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  cachedInput: a.cachedInput + b.cachedInput,
  output: a.output + b.output,
});

export class Session {
  readonly messages: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }];
  readonly meter = new CostMeter(MODEL);
  /**
   * Everything the user has said "always" to, this session. It lives on the
   * session rather than in a module-level Set so that two sessions in one
   * process — a GUI serving two tabs, a test suite — cannot leak permissions
   * into each other. (Persisting it across restarts is exercise 4.)
   */
  readonly allowlist: Allowlist = new Set<string>();

  private inflight: AbortController | null = null;

  get busy(): boolean {
    return this.inflight !== null;
  }

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
    let steps = 0;
    let hitStepLimit = false;
    const tools: ToolRun[] = [];

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        steps = step + 1;
        handlers.onStep?.(step);

        let content = "";
        let calls: { id: string; name: string; args: string }[] = [];

        for await (const ev of streamTurn(this.messages, TOOL_SPECS, controller.signal)) {
          if (ev.type === "usage") {
            // Every step is billed. A turn's cost is the SUM of its steps, and
            // a five-step turn is roughly five times the price of a chat reply
            // — which is exactly why the meter from Week 4 is still here.
            usage = add(usage, ev.usage);
            handlers.onUsage?.(usage);
            continue;
          }
          if (ev.type === "calls") {
            calls = ev.calls;
            continue;
          }
          if (first) {
            first = false;
            ttft = Date.now() - started;
            handlers.onFirstToken?.(ttft);
          }
          content += ev.text;
          text += ev.text;
          handlers.onDelta?.(ev.text);
        }

        // The assistant's own message goes into history BEFORE the results, and
        // it has to carry the tool_calls verbatim — the ids are how the API
        // pairs a result with its request.
        this.messages.push({
          role: "assistant",
          content: content || null,
          ...(calls.length
            ? {
                tool_calls: calls.map((c) => ({
                  id: c.id,
                  type: "function" as const,
                  function: { name: c.name, arguments: c.args },
                })),
              }
            : {}),
        } as Msg);

        // No tools requested → the model is done talking. Note that we decide
        // this from the presence of tool calls, not from `finish_reason`, which
        // is not reliable enough to branch on.
        if (!calls.length) return this.finish(started, { text, interrupted, ttft, usage, steps, tools, hitStepLimit });

        for (const call of calls) {
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(call.args || "{}");
          } catch {
            /* runTool reports it properly; this is only for the receipt */
          }
          handlers.onToolStart?.({ id: call.id, name: call.name, args });

          // Note that the timing comes back from dispatch rather than being
          // measured here: a call that waited ninety seconds for a human to
          // read a diff did not take ninety seconds to run, and a receipt that
          // says it did is a receipt nobody can use.
          const { result, decision, why, ms } = await this.dispatch(call, args, handlers);
          const run: ToolRun = { id: call.id, name: call.name, args, result, ms, decision, why };
          tools.push(run);
          handlers.onToolEnd?.(run);

          this.messages.push({ role: "tool", tool_call_id: call.id, content: result });
        }
      }
      hitStepLimit = true;
    } catch (err) {
      if (!isAbort(err)) {
        this.inflight = null;
        throw err;
      }
      interrupted = true;
      // An interrupt can land between "the model asked for three tools" and
      // "we ran them". If it does, history now holds an assistant message with
      // dangling tool_calls, and the NEXT request is rejected by the API. So we
      // close every one of them with a synthetic result. The real Claude Code
      // does exactly this on cancellation.
      this.closeDanglingCalls();
    } finally {
      this.inflight = null;
    }

    // Do not rely on an exception to tell you the turn was cancelled: some
    // clients throw, others simply stop iterating. The signal is true in both.
    if (controller.signal.aborted) interrupted = true;

    return this.finish(started, { text, interrupted, ttft, usage, steps, tools, hitStepLimit });
  }

  /** Bill the turn and hand back the receipt. */
  private finish(
    started: number,
    r: Omit<TurnResult, "ms">,
  ): TurnResult {
    // An interrupted stream never delivers its usage chunk, but those tokens
    // were generated and are billed. Estimating is honest; reporting zero is not.
    const usage = r.interrupted && r.usage.output === 0
      ? { ...r.usage, output: Math.ceil(r.text.length / 4) }
      : r.usage;

    if (r.interrupted) {
      const last = this.messages.at(-1);
      if (last?.role === "assistant" && typeof last.content === "string") {
        last.content = `${last.content}\n\n[interrupted by the user]`.trim();
      } else if (last?.role !== "tool") {
        this.messages.push({ role: "assistant", content: "[interrupted by the user]" });
      }
    }

    this.meter.record(usage);
    return { ...r, usage, ms: Date.now() - started };
  }

  /**
   * Where a tool call meets the permission gate — the single most important
   * function in the whole agent, because it is the one standing between a
   * language model and your filesystem.
   *
   * Classify, then deny / ask / allow, and only then run. Every path returns a
   * string: a denial is a tool RESULT, not an exception. The model reads "the
   * user denied this" and takes another route, which is exactly what you want
   * it to do.
   */
  private async dispatch(
    call: { id: string; name: string; args: string },
    args: Record<string, any>,
    handlers: TurnHandlers,
  ): Promise<{ result: string; decision: Decision; why: string; ms: number }> {
    const { decision, why } = classify(call.name, args, this.allowlist);

    if (decision === DENY) {
      return {
        decision, why, ms: 0,
        result: `<tool_error>denied: ${why}. This is blocked by policy and ` +
          `asking again will not change it. Find another way, or ask the user ` +
          `to do it themselves.</tool_error>`,
      };
    }

    if (decision === ASK) {
      // No approval handler means no human is watching. Fail closed.
      if (!handlers.approve) {
        return { decision, why, ms: 0, result: "<tool_error>denied: this interface cannot ask for approval</tool_error>" };
      }
      const answer = await handlers.approve({ id: call.id, name: call.name, args, why });
      if (answer === "always") this.allowlist.add(allowKey(call.name, args));
      else if (answer !== "yes") {
        return {
          decision, why, ms: 0,
          result: "<tool_error>the user denied this action. Do not retry it. " +
            "Explain what you wanted to do and why, or propose something else." +
            "</tool_error>",
        };
      }
    }

    const t0 = Date.now();
    const result = await runTool(call.name, call.args);
    return { result, decision, why, ms: Date.now() - t0 };
  }

  /** Give every unanswered tool_call a result, so history stays valid. */
  private closeDanglingCalls(): void {
    const answered = new Set(
      this.messages.filter((m) => m.role === "tool").map((m: any) => m.tool_call_id),
    );
    for (const msg of this.messages) {
      if (msg.role !== "assistant") continue;
      for (const call of (msg as any).tool_calls ?? []) {
        if (answered.has(call.id)) continue;
        this.messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: "<tool_error>the user interrupted before this ran</tool_error>",
        });
      }
    }
  }
}
