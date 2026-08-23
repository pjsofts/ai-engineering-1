// events.ts — everything the harness does is an EVENT, and the terminal is our
// inspector: one glyphed line per event. In Part 2 the same stream becomes
// durable (every event also lands in events.jsonl).
export type AgentEvent = { type: string; workflow?: string; [key: string]: unknown };

const GLYPH: Record<string, string> = {
  "workflow.started": "▶", "workflow.completed": "✔",
  "workflow.failed": "✘", "model.completed": "\u{1f9e0}",
  "tool.requested": "⚙", "tool.completed": "✓",
  "memory.compacted": "\u{1f5dc}", "agent.handoff": "↪",
  "plan.created": "\u{1f5fa}", "subagent.started": "├",
  "subagent.completed": "✓", "subagent.failed": "✘",
  "approval.requested": "✋", "approval.resolved": "\u{1f58a}",
};

export function emit(event: AgentEvent): AgentEvent {
  event = { ts: new Date().toTimeString().slice(0, 8), ...event };
  (globalThis as any).__emitHook?.(event);  // optional live listener (GUI); no-op in CLI
  const { ts, type, workflow, ...detail } = event;
  console.log(`  ${GLYPH[type] ?? "·"}  ${type.padEnd(21)} ` +
    JSON.stringify(detail).slice(0, 90));
  return event;
}
