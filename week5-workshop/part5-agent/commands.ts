// commands.ts — slash commands: the escape hatch for everything that is not
// a model turn. Carried over from Week 4 with three additions — /tools,
// /allowed and /revoke — because an agent with hands needs a way to answer
// "what can this thing actually do, and what have I already agreed to?"
//
// The design here is lifted from the real Claude Code source, which sorts
// every command into one of three KINDS (src/types/command.ts):
//
//   local   — runs code, prints a result. The model is never called.
//             /clear, /cost, /exit.  Cheap, instant, free.
//   render  — produces a block of UI to draw. Claude Code calls this
//             'local-jsx' because it returns a React element; we return
//             styled strings, because our renderer is console.log.
//   prompt  — is not a command at all. It expands into a message and goes
//             down the normal model path. /review is a saved prompt with a
//             short name.
//
// Why the taxonomy matters: it tells you where a command's cost lives.
// `local` costs nothing. `prompt` costs a full turn. If you skip this
// distinction you end up calling the model to answer /help.
import { c } from "./ui.js";
import { MODEL, type Msg } from "./model.js";
import { formatUSD, getModelCosts, type CostMeter } from "./cost.js";
import { TOOL_SPECS } from "./tools/specs.js";
import { SAFE_TOOLS, type Allowlist } from "./tools/permissions.js";

export interface CommandContext {
  messages: Msg[];
  meter: CostMeter;
  /** What the user has said "always" to this session. */
  allowlist: Allowlist;
  /** Set true to end the REPL after this command. */
  quit: () => void;
}

interface Base {
  name: string;
  description: string;
  aliases?: string[];
}

export type Command =
  & Base
  & (
    | { kind: "local"; run(args: string, ctx: CommandContext): string | void }
    | { kind: "render"; render(args: string, ctx: CommandContext): string }
    | { kind: "prompt"; expand(args: string, ctx: CommandContext): string }
  );

export const COMMANDS: Command[] = [
  {
    kind: "local",
    name: "clear",
    description: "forget the conversation, keep the session",
    run: (_args, ctx) => {
      // Splice, don't reassign — the array is shared with the Session object.
      const dropped = ctx.messages.length - 1;
      ctx.messages.splice(1); // index 0 is the system prompt: it survives
      return c.dim(`  cleared ${dropped} message${dropped === 1 ? "" : "s"}`);
    },
  },
  {
    kind: "local",
    name: "exit",
    aliases: ["quit", "q"],
    description: "leave",
    run: (_args, ctx) => {
      ctx.quit();
    },
  },
  {
    kind: "render",
    name: "help",
    aliases: ["?"],
    description: "list the commands",
    render: () => {
      const width = Math.max(...COMMANDS.map((cmd) => cmd.name.length)) + 2;
      const rows = COMMANDS.map((cmd) => {
        const alias = cmd.aliases?.length ? c.dim(` (${cmd.aliases.map((a) => "/" + a).join(", ")})`) : "";
        return `  ${c.blue("/" + cmd.name.padEnd(width))}${cmd.description}${alias}`;
      });
      return ["", c.bold("  commands"), ...rows, "",
        c.dim("  anything else is sent to the model")].join("\n");
    },
  },
  {
    kind: "render",
    name: "status",
    description: "model, message count, rough context size",
    render: (_args, ctx) => {
      const chars = ctx.messages.reduce(
        (n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0);
      return [
        "",
        `  ${c.dim("model")}     ${MODEL}`,
        `  ${c.dim("messages")}  ${ctx.messages.length - 1}`,
        `  ${c.dim("context")}   ~${Math.round(chars / 4)} tokens ${c.dim("(chars ÷ 4)")}`,
        `  ${c.dim("tools")}     ${TOOL_SPECS.length} (${SAFE_TOOLS.size} read-only)`,
        `  ${c.dim("allowed")}   ${ctx.allowlist.size || c.dim("nothing")}`,
        `  ${c.dim("spent")}     ${formatUSD(ctx.meter.totalUSD)} over ${ctx.meter.turns} turn(s)`,
        "",
      ].join("\n");
    },
  },
  {
    kind: "render",
    name: "cost",
    description: "the bill so far, broken down",
    render: (_args, ctx) => {
      const m = ctx.meter;
      if (!m.turns) return c.dim("\n  no turns yet\n");
      const { known } = getModelCosts(m.model);
      const mins = (Date.now() - m.startedAt) / 60000;
      const row = (label: string, tokens: number, usd: number) =>
        `  ${c.dim(label.padEnd(14))}${String(tokens).padStart(8)}  ${formatUSD(usd).padStart(10)}`;
      const { costs } = getModelCosts(m.model);
      return [
        "",
        `  ${c.bold("session cost")}  ${c.dim(m.model)}`,
        "",
        row("input", m.total.input, (m.total.input * costs.input) / 1_000_000),
        row("cached input", m.total.cachedInput, (m.total.cachedInput * costs.cachedInput) / 1_000_000),
        row("output", m.total.output, (m.total.output * costs.output) / 1_000_000),
        `  ${c.dim("".padEnd(14))}${"".padStart(8)}  ${c.dim("----------")}`,
        `  ${c.bold("total".padEnd(14))}${"".padStart(8)}  ${c.green(formatUSD(m.totalUSD).padStart(10))}`,
        "",
        c.dim(`  ${m.turns} turn(s) over ${mins.toFixed(1)} min · ${formatUSD(m.totalUSD / m.turns)}/turn`),
        known ? "" : c.amber(`  ⚠ no price on file for ${m.model} — estimated at gpt-4o-mini rates`),
        "",
      ].filter(Boolean).join("\n");
    },
  },
  {
    kind: "render",
    name: "tools",
    description: "what the model can do, and which of those ask first",
    render: () => {
      const rows = TOOL_SPECS.map((t: any) => {
        const name = t.function.name as string;
        const safe = SAFE_TOOLS.has(name);
        const tag = safe ? c.green("auto") : c.amber("asks");
        // The first sentence of the description is the model's whole idea of
        // when to use this tool. Showing it here is not decoration: reading it
        // back is how you notice that it is vague.
        const first = String(t.function.description).split(". ")[0];
        return `  ${c.bold(name.padEnd(13))}${tag}  ${c.dim(first.slice(0, 60))}`;
      });
      return ["", c.bold("  tools"), ...rows, "",
        c.dim("  auto = read-only, never asks · asks = a human approves each call"), ""].join("\n");
    },
  },
  {
    kind: "render",
    name: "allowed",
    description: "what you have said 'always' to this session",
    render: (_args, ctx) => {
      if (!ctx.allowlist.size) {
        return c.dim("\n  nothing allowlisted — every write and command still asks\n");
      }
      const rows = [...ctx.allowlist].sort().map((key) => {
        const [tool, program] = key.split(":");
        return `  ${c.violet("✓")} ${c.bold(tool)}${program ? ` ${c.dim(program)}` : ""}`;
      });
      return ["", c.bold("  allowlisted this session"), ...rows, "",
        c.dim("  gone when the process exits — persisting it is exercise 4"), ""].join("\n");
    },
  },
  {
    kind: "local",
    name: "revoke",
    description: "forget every 'always' — back to asking about everything",
    run: (_args, ctx) => {
      const n = ctx.allowlist.size;
      ctx.allowlist.clear();
      return c.dim(`  revoked ${n} allowlist entr${n === 1 ? "y" : "ies"}`);
    },
  },
  {
    kind: "prompt",
    name: "review",
    description: "<file> — ask for a code review of a file's contents",
    expand: (args) => {
      if (!args) return "Explain what you would need in order to review code.";
      return `Review this file and list concrete problems, worst first. ` +
        `Be specific and cite line content. File: ${args}`;
    },
  },
  {
    kind: "prompt",
    name: "explain",
    description: "<thing> — explain it at a senior-engineer level",
    expand: (args) => `Explain ${args || "the last thing you said"} to a senior engineer. No preamble.`,
  },
];

const byName = new Map<string, Command>();
for (const cmd of COMMANDS) {
  byName.set(cmd.name, cmd);
  for (const alias of cmd.aliases ?? []) byName.set(alias, cmd);
}

export type CommandResult =
  | { type: "handled"; output?: string }        // done — nothing to send
  | { type: "prompt"; text: string }            // send this to the model
  | { type: "unknown"; name: string };

/**
 * Parse and run a leading-slash line.
 * Returns null when the line is NOT a command, so the caller sends it as-is.
 */
export function dispatch(line: string, ctx: CommandContext): CommandResult | null {
  if (!line.startsWith("/")) return null;

  const space = line.indexOf(" ");
  const name = (space === -1 ? line.slice(1) : line.slice(1, space)).toLowerCase();
  const args = space === -1 ? "" : line.slice(space + 1).trim();

  const cmd = byName.get(name);
  if (!cmd) return { type: "unknown", name };

  switch (cmd.kind) {
    case "local":
      return { type: "handled", output: cmd.run(args, ctx) || undefined };
    case "render":
      return { type: "handled", output: cmd.render(args, ctx) };
    case "prompt":
      return { type: "prompt", text: cmd.expand(args, ctx) };
  }
}

/** Names for tab-completion, longest-prefix style. */
export function completions(prefix: string): string[] {
  return [...byName.keys()].map((n) => "/" + n).filter((n) => n.startsWith(prefix)).sort();
}
