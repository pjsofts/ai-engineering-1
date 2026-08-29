// session.ts — the agent core, with NO knowledge of the terminal.
//
// This split is the most important idea of the week, and it is worth saying
// out loud in class: the thing that talks to the model and the thing that
// draws on the screen are different objects. Session owns the conversation.
// It hands out text as it arrives and does not care whether that text ends up
// in a terminal, a browser, a Slack message or a test assertion.
//
// Proof that the split is real: week4-gui/ imports this exact file and renders
// it in a browser. Zero changes.
import { streamTurn, SYSTEM_PROMPT, type Msg } from "./model.js";

export interface TurnHandlers {
  /** Called for every text delta, in order, as it arrives. */
  onDelta?: (text: string) => void;
  /** Called once, with the elapsed ms, when the first delta lands. */
  onFirstToken?: (ms: number) => void;
}

export class Session {
  readonly messages: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }];

  /** Run one user turn. Resolves with the complete assistant text. */
  async send(input: string, handlers: TurnHandlers = {}): Promise<string> {
    this.messages.push({ role: "user", content: input });

    const started = Date.now();
    let first = true;
    let full = "";

    for await (const delta of streamTurn(this.messages)) {
      if (first) {
        first = false;
        handlers.onFirstToken?.(Date.now() - started);
      }
      full += delta;
      handlers.onDelta?.(delta);
    }

    this.messages.push({ role: "assistant", content: full });
    return full;
  }
}
