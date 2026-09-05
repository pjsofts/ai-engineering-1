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

// ---------------------------------------------------------------------------
// Week 5 additions: drawing a tool call.
//
// A turn is no longer "the model said something". It is a sequence of actions
// with results, and the user has to be able to audit it at a glance. Three
// rules, all of them borrowed from watching real agents fail in front of an
// audience:
//
//   1. Show the tool BEFORE it runs, not after. A three-second grep that
//      appears only once it is finished looks like a freeze.
//   2. Show the arguments, not a summary. "editing a file" is not auditable;
//      the path and the diff are.
//   3. Show the result in ONE line. The model gets the whole 2,000-line file;
//      the human gets "read 412 lines". They have different jobs.
const TOOL_ICON: Record<string, string> = {
  read_file: "◇", write_file: "◆", edit_file: "✎",
  run_bash: "$", glob_files: "❯", grep_search: "⌕",
};

/** The one-line preview of what a tool is about to do. */
export function toolPreview(name: string, args: Record<string, any>): string {
  switch (name) {
    case "read_file":   return String(args.path ?? "");
    case "write_file":  return `${args.path} (${String(args.content ?? "").length} chars)`;
    case "edit_file":   return String(args.path ?? "");
    case "run_bash":    return String(args.command ?? "");
    case "glob_files":  return String(args.pattern ?? "");
    case "grep_search": return `/${args.pattern}/${args.glob && args.glob !== "*" ? ` in ${args.glob}` : ""}`;
    default:            return JSON.stringify(args).slice(0, 80);
  }
}

export function toolLine(name: string, args: Record<string, any>): string {
  const icon = TOOL_ICON[name] ?? "•";
  return `  ${c.violet(icon)} ${c.bold(name)} ${c.dim(toolPreview(name, args))}`;
}

/**
 * Collapse a tool result to one line for the human. The model still receives
 * every byte — this is purely the receipt.
 */
export function resultLine(result: string, ms: number, note = ""): string {
  const failed = result.startsWith("<tool_error>");
  const first = result.split("\n")[0].replace(/<\/?tool_error>/g, "");
  const lines = result.split("\n").length;
  const body = failed
    ? c.red(first.slice(0, 100))
    : c.dim(lines > 1 ? `${lines} lines` : first.slice(0, 100) || "ok");
  const tag = note ? c.dim(` [${note}]`) : "";
  return `    ${failed ? c.red("⨯") : c.green("✔")} ${body} ${c.dim(`(${ms}ms)`)}${tag}`;
}

// ---------------------------------------------------------------------------
// Part 4: the permission prompt.
//
// This is where trust is built or destroyed. Show the user EXACTLY what is
// about to happen — the command, the path, the two lines of the diff — before
// anything runs. A vague "the agent wants to do something. Allow?" teaches
// people to press y without reading, which is worse than having no gate at all.
export interface ApprovalView {
  name: string;
  args: Record<string, any>;
  why: string;
}

/** The box, as lines. Kept separate from the asking so it is easy to test. */
export function permissionBox(req: ApprovalView): string[] {
  const bar = c.amber("│");
  const lines = [
    `\n${c.amber("┌─ permission needed")}`,
    `${bar} ${c.bold(req.name)} ${c.dim(`— ${req.why}`)}`,
  ];
  const { name, args } = req;
  if (name === "run_bash") {
    lines.push(`${bar}   ${c.bold("$")} ${args.command}`);
  } else if (name === "edit_file") {
    lines.push(`${bar}   ${args.path}`);
    for (const l of String(args.old_string ?? "").split("\n").slice(0, 6)) {
      lines.push(`${bar}   ${c.red(`- ${l.slice(0, 90)}`)}`);
    }
    for (const l of String(args.new_string ?? "").split("\n").slice(0, 6)) {
      lines.push(`${bar}   ${c.green(`+ ${l.slice(0, 90)}`)}`);
    }
  } else if (name === "write_file") {
    const content = String(args.content ?? "");
    const n = content.split("\n").length;
    lines.push(`${bar}   ${args.path} ${c.dim(`(${n} lines, ${content.length} chars)`)}`);
    for (const l of content.split("\n").slice(0, 6)) {
      lines.push(`${bar}   ${c.green(`+ ${l.slice(0, 90)}`)}`);
    }
  } else {
    lines.push(`${bar}   ${c.dim(JSON.stringify(args).slice(0, 120))}`);
  }
  return lines;
}

/** Draw the box and block until the human answers. */
export async function askApproval(
  rl: { question(q: string): Promise<string> },
  req: ApprovalView,
): Promise<"yes" | "always" | "no"> {
  for (const line of permissionBox(req)) console.log(line);
  let answer: string;
  try {
    answer = await rl.question(`${c.amber("└─")} ${c.green("[y]es")} · ${c.violet("[a]lways")} · ${c.dim("[N]o")} `);
  } catch {
    return "no";                    // stdin closed mid-question: deny
  }
  // Default is NO. The capital N in the prompt is not decoration — pressing
  // Enter without reading must never approve anything.
  const key = answer.trim().toLowerCase();
  if (key === "y" || key === "yes") return "yes";
  if (key === "a" || key === "always") return "always";
  return "no";
}
