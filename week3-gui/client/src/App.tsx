import React, { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "./Markdown";
import Bench, { type BenchProgress } from "./Bench";

// ---------- types ----------
interface PartDef {
  id: string; dir: string; title: string; blurb: string;
  supervised?: boolean; options?: string[]; sample: string;
}
interface AgentEvent { ts?: string; type: string; workflow?: string; [k: string]: unknown }
type Status = "idle" | "running" | "recovering" | "done" | "crashed" | "suspended" | "decided" | "error" | "reset";

interface ChatItem {
  id: number;
  role: "user" | "assistant" | "system" | "draft" | "approval" | "crash" | "jev";
  text: string;
  event?: AgentEvent;   // for role "jev": the jev.* event the card renders
  meta?: string;
  wfId?: string;
}

const GLYPH: Record<string, string> = {
  "workflow.started": "▶", "workflow.completed": "✔", "workflow.failed": "✘",
  "tool.requested": "⚙", "tool.completed": "✓", "memory.compacted": "🗜",
  "agent.handoff": "↪", "plan.created": "🗺", "subagent.started": "├",
  "subagent.completed": "✓", "subagent.failed": "✘",
  "approval.requested": "✋", "approval.resolved": "🖊",
  "jev.requested": "?", "jev.answered": "⚡", "jev.triaged": "🏷", "jev.gate": "🛡",
};
const EVENT_TONE: Record<string, string> = {
  "workflow.started": "blue", "workflow.completed": "green", "workflow.failed": "red",
  "tool.requested": "amber", "tool.completed": "green", "memory.compacted": "violet",
  "agent.handoff": "violet", "plan.created": "blue", "subagent.started": "blue",
  "subagent.completed": "green", "subagent.failed": "red",
  "approval.requested": "amber", "approval.resolved": "violet",
  "jev.requested": "teal", "jev.answered": "teal", "jev.triaged": "teal", "jev.gate": "teal",
};

function activityLabel(e: AgentEvent): string {
  switch (e.type) {
    case "workflow.started": return "starting workflow…";
    case "tool.requested": return `calling ${e.name}…`;
    case "memory.compacted": return `compacting memory (${e.summarized_turns} turns → summary)…`;
    case "agent.handoff": return `handing off: ${e.from} → ${e.to}…`;
    case "plan.created": return `plan ready — dispatching ${(e.steps as string[])?.length ?? ""} investigators…`;
    case "subagent.started": return `investigator "${e.agent}" working…`;
    case "subagent.completed": return `investigator "${e.agent}" reported back…`;
    case "subagent.failed": return `investigator "${e.agent}" crashed — continuing…`;
    case "approval.requested": return "waiting for a human decision…";
    case "approval.resolved": return "human decided — continuing…";
    case "jev.requested": return `asking Jev: ${e.purpose}…`;
    case "jev.answered": return `Jev answered (${e.latency_ms} ms) — code is deciding…`;
    case "jev.triaged": return "LLM is drafting replies from Jev's triage…";
    case "jev.gate": return e.verdict === "pass" ? "check passed — sending…" : "send blocked — LLM will redraft…";
    default: return "model is thinking…";
  }
}

let nextId = 1;

export default function App() {
  const [parts, setParts] = useState<PartDef[]>([]);
  // ?tab=part2jev or ?tab=bench deep-links straight to a tab.
  const [sel, setSel] = useState(() => new URLSearchParams(location.search).get("tab") ?? "part1");
  const [task, setTask] = useState("");
  const [taskDirty, setTaskDirty] = useState(false);
  const [crash, setCrash] = useState(false);
  const [chaos, setChaos] = useState(false);
  const [events, setEvents] = useState<Record<string, AgentEvent[]>>({});
  const [chat, setChat] = useState<Record<string, ChatItem[]>>({});
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [activity, setActivity] = useState<Record<string, string>>({});
  const [busyPart, setBusyPart] = useState<string | null>(null);
  const [benchProgress, setBenchProgress] = useState<BenchProgress | null>(null);
  const eventsEnd = useRef<HTMLDivElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  const part = useMemo(() => parts.find((p) => p.id === sel), [parts, sel]);

  useEffect(() => {
    fetch("/api/parts").then((r) => r.json()).then(setParts);
  }, []);
  useEffect(() => {
    if (!taskDirty && part) setTask(part.sample ?? "");
  }, [part, taskDirty]);

  // ---------- SSE ----------
  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.kind === "hello") { setBusyPart(msg.busy ?? null); return; }
      if (msg.kind === "bench") {
        setBenchProgress(msg);
        setBusyPart(msg.status === "running" ? "bench" : null);
        return;
      }
      const pid: string = msg.part;
      if (msg.kind === "event") {
        const e: AgentEvent = msg.event;
        setEvents((s) => ({ ...s, [pid]: [...(s[pid] ?? []), e] }));
        setActivity((s) => ({ ...s, [pid]: activityLabel(e) }));
        if (e.type === "tool.requested" && e.name === "draftReply") {
          const args = e.args as any;
          if (args?.message) addChat(pid, { role: "draft", text: String(args.message),
            meta: `draftReply · ${args.item_id ?? ""}` });
        }
        if (e.type === "jev.answered" || e.type === "jev.triaged" || e.type === "jev.gate") {
          addChat(pid, { role: "jev", text: "", event: e });
        }
        if (e.type === "agent.handoff") {
          addChat(pid, { role: "system", text: `Handoff: ${e.from} → ${e.to} — ${e.reason ?? ""}` });
        }
        if (e.type === "approval.requested") {
          const args = e.args as any;
          addChat(pid, { role: "approval", wfId: String(e.workflow),
            text: `The agent wants to run ${e.action}(${JSON.stringify(args ?? {})}).`,
            meta: "workflow suspended — the process exits until you decide" });
        }
        return;
      }
      if (msg.kind === "status") {
        const st: Status = msg.status;
        setStatus((s) => ({ ...s, [pid]: st }));
        if (st === "running" || st === "recovering") {
          setBusyPart(pid);
          setActivity((s) => ({ ...s, [pid]:
            st === "recovering" ? `recovering ${msg.detail} — replaying cached steps…` : "model is thinking…" }));
        } else if (st === "done") {
          setBusyPart(null);
          if (msg.detail && msg.detail !== "nothing to resume")
            addChat(pid, { role: "assistant", text: String(msg.detail) });
          else if (msg.detail === "nothing to resume")
            addChat(pid, { role: "system", text: "Nothing to resume — no pending workflows." });
        } else if (st === "crashed") {
          setBusyPart(null);
          addChat(pid, { role: "crash", text: String(msg.detail) });
        } else if (st === "suspended") {
          setBusyPart(null);
        } else if (st === "error") {
          setBusyPart(null);
          addChat(pid, { role: "system", text: `Error: ${msg.detail}` });
        } else if (st === "reset") {
          setBusyPart(null);
          if (pid === "all") { setEvents({}); setChat({}); setStatus({}); }
          else {
            setEvents((s) => ({ ...s, [pid]: [] }));
            setChat((s) => ({ ...s, [pid]: [] }));
          }
        }
      }
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addChat(pid: string, item: Omit<ChatItem, "id">) {
    setChat((s) => ({ ...s, [pid]: [...(s[pid] ?? []), { ...item, id: nextId++ }] }));
  }

  useEffect(() => { eventsEnd.current?.scrollIntoView({ behavior: "smooth" }); },
    [events[sel]?.length]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); },
    [chat[sel]?.length, busyPart]);

  // ---------- actions ----------
  const running = busyPart !== null;
  const myStatus = status[sel] ?? "idle";

  async function run(resume = false) {
    if (running || !part) return;
    if (!resume) addChat(sel, { role: "user", text: task });
    await fetch("/api/run", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ part: sel, task, resume,
        crash: !!part.options?.includes("crash") && crash, chaos: sel === "part6" && chaos }) });
  }
  async function approve(wfId: string, ok: boolean) {
    await fetch("/api/approve", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ part: sel, wfId, approved: ok }) });
    addChat(sel, { role: "system",
      text: ok ? `You approved ${wfId}. Press Resume to continue it.`
               : `You denied ${wfId}. Press Resume — the refund will NOT run.` });
  }
  async function reset(all = false) {
    await fetch("/api/reset", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(all ? {} : { part: sel }) });
  }

  const showResume = sel !== "part1";
  const decidedIds = useRef(new Set<string>());

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">⚙</span>
          <div>
            <h1>Week 3 · The Agent Harness</h1>
            <p>watch the event stream earn its keep, part by part</p>
          </div>
        </div>
        <nav>
          {parts.map((p) => (
            <button key={p.id}
              className={`tab ${sel === p.id ? "active" : ""} ${busyPart === p.id ? "busy" : ""}`}
              onClick={() => { setSel(p.id); setTaskDirty(false); }}>
              {p.title}
            </button>
          ))}
          <button className={`tab ${sel === "bench" ? "active" : ""} ${busyPart === "bench" ? "busy" : ""}`}
            onClick={() => setSel("bench")}>📊 Jev benchmark</button>
        </nav>
      </header>

      {part && (
        <section className="controls">
          <p className="blurb">{part.blurb}</p>
          <div className="row">
            <textarea value={task} rows={4}
              onChange={(e) => { setTask(e.target.value); setTaskDirty(true); }} />
            <div className="buttons">
              <button className="primary" disabled={running} onClick={() => run(false)}>
                {running && busyPart === sel ? <span className="spinner light" /> : "▶"} Run
              </button>
              {showResume && (
                <button disabled={running} onClick={() => run(true)} title="replay pending workflows">
                  ↻ Resume
                </button>)}
              <button className="ghost" disabled={running} onClick={() => reset(false)}>Reset part</button>
            </div>
          </div>
          <div className="row opts">
            {part.options?.includes("crash") && (
              <label><input type="checkbox" checked={crash} onChange={(e) => setCrash(e.target.checked)} />
                💥 crash mid-workflow (CRASH_AT_STEP=2) — then Run again to recover</label>)}
            {part.options?.includes("chaos") && (
              <label><input type="checkbox" checked={chaos} onChange={(e) => setChaos(e.target.checked)} />
                ☠ kill the technical investigator (CHAOS_FAIL) — graceful degradation</label>)}
            <span className={`pill ${myStatus}`}>{myStatus}</span>
          </div>
        </section>
      )}

      {sel === "bench" && <Bench progress={benchProgress} busy={busyPart} />}
      {sel !== "bench" && <main>
        <section className="panel chat">
          <h2>💬 Conversation</h2>
          <div className="scroll">
            {(chat[sel] ?? []).map((c) => (
              <div key={c.id} className={`bubble ${c.role}`}>
                {c.meta && <div className="meta">{c.meta}</div>}
                {c.role === "jev" && c.event ? <JevCard e={c.event} />
                  : c.role === "assistant" || c.role === "draft"
                  ? <Markdown text={c.text} />
                  : <div className="text">{c.text}</div>}
                {c.role === "approval" && c.wfId && !decidedIds.current.has(c.wfId) && (
                  <div className="approve-row">
                    <button className="yes" onClick={() => { decidedIds.current.add(c.wfId!); approve(c.wfId!, true); }}>✔ Approve</button>
                    <button className="no" onClick={() => { decidedIds.current.add(c.wfId!); approve(c.wfId!, false); }}>✘ Deny</button>
                  </div>)}
              </div>
            ))}
            {busyPart === sel && (
              <div className="bubble assistant thinking">
                <span className="spinner" />
                <span>{activity[sel] ?? "model is thinking…"}</span>
              </div>)}
            {!chat[sel]?.length && busyPart !== sel && (
              <div className="empty">Press <b>Run</b> to start this part's demo.<br />
                The sample task is pre-filled — edit it if you like.</div>)}
            <div ref={chatEnd} />
          </div>
        </section>

        <section className="panel events">
          <h2>🧾 Event stream <span className="count">{events[sel]?.length ?? 0}</span></h2>
          <div className="scroll mono">
            {(events[sel] ?? []).map((e, i) => <EventRow key={i} e={e} />)}
            {!events[sel]?.length && (
              <div className="empty">Every harness action lands here as an event —<br />
                the same stream that goes to <code>events.jsonl</code>.</div>)}
            <div ref={eventsEnd} />
          </div>
        </section>
      </main>}
    </div>
  );
}

function EventRow({ e }: { e: AgentEvent }) {
  const [open, setOpen] = useState(false);
  const { ts, type, workflow, ...detail } = e;
  const tone = EVENT_TONE[type] ?? "grey";
  const summary = detail.purpose ? String(detail.purpose)
    : type === "jev.triaged" ? `${detail.item_id} → ${detail.category}`
    : type === "jev.gate" ? `${detail.item_id}: ${detail.verdict}`
    : detail.name ? String(detail.name)
    : detail.agent ? String(detail.agent)
    : detail.to ? `→ ${detail.to}`
    : detail.action ? String(detail.action)
    : "";
  return (
    <div className={`event ${tone}`} onClick={() => setOpen(!open)}>
      <span className="glyph">{GLYPH[type] ?? "·"}</span>
      <span className="etype">{type}</span>
      {summary && <span className="esummary">{summary}</span>}
      <span className="fill" />
      {workflow && <span className="wf">{workflow}</span>}
      {ts && <span className="ets">{ts}</span>}
      {open && Object.keys(detail).length > 0 && (
        <pre className="edetail">{JSON.stringify(detail, null, 2)}</pre>)}
    </div>
  );
}

// ---------- Jev cards: what Jev returned, and what CODE decided from it ----------
const pct = (p: number) => `${Math.round(p * 100)}%`;
function Bar({ p, strong, bad }: { p: number; strong?: boolean; bad?: boolean }) {
  return (
    <span className="jbar"><span className={`jfill ${strong ? "strong" : ""} ${bad ? "bad" : ""}`}
      style={{ width: pct(p) }} /></span>);
}

function JevCard({ e }: { e: AgentEvent }) {
  if (e.type === "jev.answered") {
    const answers = e.answers as Record<string, any>;
    const usage = e.usage as { input_tokens: number; output_tokens: number } | undefined;
    return (
      <div className="jev">
        <div className="jhead">⚡ <b>Jev returned</b> · {String(e.purpose)}
          <span className="jstats">{String(e.latency_ms)} ms
            {usage && ` · ${usage.input_tokens}→${usage.output_tokens} tok`}</span></div>
        {Object.entries(answers).map(([qid, a]) => (
          <div key={qid} className="jq">
            <div className="jqid"><code>{qid}</code> <span className="jtype">{a.type}</span>
              {a.type === "choice" && <span className="jconf">confidence {pct(a.confidence)}</span>}</div>
            {a.type === "choice" && Object.entries(a.probabilities as Record<string, number>)
              .sort((x, y) => y[1] - x[1]).map(([opt, p]) => (
                <div key={opt} className={`jrow ${opt === a.choice ? "chosen" : ""}`}>
                  <span className="jlabel">{opt === a.choice ? "▸ " : ""}{opt}</span>
                  <Bar p={p} strong={opt === a.choice} /><span className="jp">{pct(p)}</span>
                </div>))}
            {a.type === "noul" && (
              <div className="jrow"><span className="jlabel">P(yes)</span>
                <Bar p={a.noul} strong={a.noul >= 0.5} /><span className="jp">{pct(a.noul)}</span></div>)}
            {a.type === "score" && (
              <div className="jrow"><span className="jlabel">score</span>
                <span className="jp">{Number(a.score).toFixed(2)}</span></div>)}
          </div>))}
      </div>);
  }
  if (e.type === "jev.triaged") {
    const arts = e.articles as { topic: string; p: number }[];
    return (
      <div className="jev decision">
        <div className="jhead">🏷 <b>Code decided</b> · triage {String(e.item_id)}</div>
        <div>category <b>{String(e.category)}</b> ({pct(Number(e.confidence))} confident
          {e.low_confidence ? <span className="warn"> — below {pct(Number(e.low_confidence_below))}, flagged LOW</span> : ""})</div>
        <div>KB articles (P ≥ {pct(Number(e.article_threshold))}): {arts.length
          ? arts.map((a) => `${a.topic} ${pct(a.p)}`).join(", ") : <i>none — reply will defer to a specialist</i>}</div>
        <div className="jnote">→ handed to the LLM as context; it only writes the reply.</div>
      </div>);
  }
  // jev.gate
  const pass = e.verdict === "pass";
  return (
    <div className={`jev decision ${pass ? "pass" : "blocked"}`}>
      <div className="jhead">🛡 <b>Code decided</b> · sendReply {String(e.item_id)}:
        <b className="jverdict"> {pass ? "SEND" : "BLOCKED"}</b></div>
      <div className="jrow"><span className="jlabel">grounded</span>
        <Bar p={Number(e.grounded)} strong bad={Number(e.grounded) < Number(e.threshold)} /><span className="jp">{pct(Number(e.grounded))}</span></div>
      <div className="jrow"><span className="jlabel">on_topic</span>
        <Bar p={Number(e.on_topic)} strong bad={Number(e.on_topic) < Number(e.threshold)} /><span className="jp">{pct(Number(e.on_topic))}</span></div>
      <div className="jnote">both must be ≥ {pct(Number(e.threshold))}{pass ? "" : ` — ${e.reason}; the LLM gets the reason and redrafts`}</div>
    </div>);
}
