// ui.ts — the whole "UI framework" for Part 1: ANSI escape codes and a spinner.
// No React, no Ink, no dependencies. A terminal UI is just strings plus a few
// escape sequences that move the cursor around. Everything in this file is
// something you can print by hand.

export const c = {
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  blue:   (s: string) => `\x1b[38;5;75m${s}\x1b[0m`,
  green:  (s: string) => `\x1b[38;5;78m${s}\x1b[0m`,
  amber:  (s: string) => `\x1b[38;5;214m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[38;5;203m${s}\x1b[0m`,
  violet: (s: string) => `\x1b[38;5;141m${s}\x1b[0m`,
};

// \r        = carriage return: move the cursor to column 0 of THIS line
// \x1b[2K   = erase the whole line
// Together: overwrite the current line in place. That is 100% of the trick
// behind every terminal spinner you have ever seen.
const CLEAR_LINE = "\r\x1b[2K";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  private timer: NodeJS.Timeout | null = null;
  private frame = 0;
  private started = 0;
  private label: string;

  constructor(label = "thinking") {
    this.label = label;
  }

  start(): void {
    if (this.timer) return;
    this.started = Date.now();
    // unref() so a live spinner can never hold the process open by itself.
    this.timer = setInterval(() => this.paint(), 80);
    this.timer.unref?.();
    this.paint();
  }

  /** Change the text without restarting the animation. */
  setLabel(label: string): void {
    this.label = label;
  }

  private paint(): void {
    const secs = ((Date.now() - this.started) / 1000).toFixed(1);
    const f = FRAMES[this.frame++ % FRAMES.length];
    process.stdout.write(
      `${CLEAR_LINE}${c.violet(f)} ${c.dim(this.label)} ${c.dim(`(${secs}s)`)}`,
    );
  }

  /** Stop and wipe the line, leaving the cursor where it started. */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    process.stdout.write(CLEAR_LINE);
  }
}

export function banner(title: string, subtitle: string): void {
  console.log();
  console.log(`  ${c.bold(c.blue("mycode"))} ${c.dim("·")} ${c.bold(title)}`);
  console.log(`  ${c.dim(subtitle)}`);
  console.log();
}

/**
 * rl.question, but EOF is an answer rather than an exception.
 *
 * Ctrl+D closes stdin. readline then rejects (or throws ERR_USE_AFTER_CLOSE on
 * the next call), which is technically correct and completely useless as a
 * user experience. Every REPL needs this wrapper; almost none of them have it
 * until someone pipes input into the program and watches it crash.
 */
export async function ask(
  rl: { question(q: string): Promise<string> },
  prompt: string,
): Promise<string | null> {
  try {
    return await rl.question(prompt);
  } catch {
    return null;   // stdin closed — Ctrl+D, or a pipe that ran dry
  }
}
