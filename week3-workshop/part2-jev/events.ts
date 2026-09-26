// events.ts — the same durable stream as Part 2: every event is appended to
// events.jsonl BEFORE it prints. New here: jev.* events (see jev.ts), so you can
// see exactly what Jev was asked and what it answered.
import fs from "node:fs";
export type AgentEvent = { type: string; workflow?: string; [key: string]: unknown };

const GLYPH: Record<string, string> = {
  "workflow.started": "▶", "workflow.completed": "✔",
  "workflow.failed": "✘", "model.completed": "\u{1f9e0}",
  "tool.requested": "⚙", "tool.completed": "✓",
  "memory.compacted": "\u{1f5dc}", "agent.handoff": "↪",
  "plan.created": "\u{1f5fa}", "subagent.started": "├",
  "subagent.completed": "✓", "subagent.failed": "✘",
  "approval.requested": "✋", "approval.resolved": "\u{1f58a}",
  "jev.requested": "?", "jev.answered": "⚡", "jev.triaged": "\u{1f3f7}", "jev.gate": "\u{1f6e1}",
};

export function emit(event: AgentEvent): AgentEvent {
  event = { ts: new Date().toTimeString().slice(0, 8), ...event };
  (globalThis as any).__emitHook?.(event);  // optional live listener (GUI); no-op in CLI
  fs.appendFileSync("events.jsonl", JSON.stringify(event) + "\n"); // durable first,
  const { ts, type, workflow, ...detail } = event;
  console.log(`  ${GLYPH[type] ?? "·"}  ${type.padEnd(21)} ` +
    JSON.stringify(detail).slice(0, 90));                           // live second
  return event;
}
