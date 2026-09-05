// App.tsx — the browser front-end for mycode v0.2.
//
// Compare it with week5-workshop/part5-agent/repl.ts. Same agent, same session
// object, two vocabularies of interface:
//
//   toolLine()          ↔  <ToolCall running />
//   resultLine()        ↔  the same card, filled in
//   askApproval(rl, …)  ↔  <Approval /> plus POST /api/approve
//   the dim footer      ↔  the rail on the right
//   Ctrl+C              ↔  Stop, and Esc
//
// The interesting one is the third. In the terminal, approval is a keypress on
// a stream the agent is already reading. Here it is a round trip: the server
// parks a promise, streams the question to this page, and the agent waits until
// a click travels back. Two very different mechanisms, one unchanged core.
import { useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import ToolCall, { type ToolRun } from "./ToolCall";
import Approval, { type ApprovalRequest } from "./Approval";

interface Meter {
  turns: number;
  total: { input: number; cachedInput: number; output: number };
  totalUSD: number;
  breakdown: { input: number; cachedInput: number; output: number };
}
interface ToolInfo { name: string; safe: boolean; description: string }
interface ServerState {
  model: string;
  busy: boolean;
  workspace: string;
  maxSteps: number;
  prices: { input: number; cachedInput: number; output: number };
  pricesKnown: boolean;
  allowlist: string[];
  tools: ToolInfo[];
  messages: { role: string; content: string }[];
  meter: Meter;
}
interface CommandInfo { name: string; kind: string; description: string; aliases: string[] }

// One transcript is a list of these. Tool receipts and approval cards live in
// the same stream as the prose, in the order they happened — an agent's answer
// IS the sequence of things it did, and hiding that in a side panel makes the
// most interesting part of the product invisible.
type Item =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; live?: boolean; note?: string }
  | { kind: "system"; text: string }
  | { kind: "tool"; run: ToolRun; running: boolean }
  | { kind: "approval"; request: ApprovalRequest; answer?: "yes" | "always" | "no" };

const usd = (n: number) =>
  n === 0 ? "$0.00" : n < 0.01 ? `$${n.toFixed(5)}` : n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;

export default function App() {
  const [state, setState] = useState<ServerState | null>(null);
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [ttft, setTtft] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const pendingId = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/state").then((r) => r.json()).then(setState);
    fetch("/api/commands").then((r) => r.json()).then(setCommands);
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [items]);

  // y / a / n answer the open question from anywhere on the page, the way the
  // terminal does. A keyboard shortcut is not a nicety here: the whole agent is
  // stopped, and reaching for the mouse every time is what makes people start
  // clicking "always" on things they have not read.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pendingId.current) return;
      if (e.target instanceof HTMLTextAreaElement) return;
      const map: Record<string, "yes" | "always" | "no"> = { y: "yes", a: "always", n: "no" };
      const choice = map[e.key.toLowerCase()];
      if (choice) { e.preventDefault(); answer(pendingId.current, choice); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function answer(id: string, choice: "yes" | "always" | "no") {
    pendingId.current = null;
    setItems((list) => list.map((it) =>
      it.kind === "approval" && it.request.id === id ? { ...it, answer: choice } : it));
    await fetch("/api/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, choice }),
    });
    fetch("/api/state").then((r) => r.json()).then(setState);
  }

  /** Append a delta to the live assistant bubble, opening one if needed. */
  function appendDelta(text: string) {
    setItems((list) => {
      const last = list[list.length - 1];
      if (last?.kind === "assistant" && last.live) {
        return [...list.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...list, { kind: "assistant", text, live: true }];
    });
  }

  async function runTurn(text: string, label?: string) {
    setBusy(true);
    setTtft(null);
    setStep(0);
    if (label) setItems((list) => [...list, { kind: "user", text: label }]);

    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.body) { setBusy(false); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const raw of events) {
        const line = raw.replace(/^data: /, "");
        if (!line.trim()) continue;
        const ev = JSON.parse(line);

        if (ev.type === "ttft") setTtft(ev.ms);
        else if (ev.type === "step") setStep(ev.step + 1);
        else if (ev.type === "delta") appendDelta(ev.text);
        else if (ev.type === "tool_start") {
          // Close the live bubble: whatever the model said before reaching for a
          // tool is finished, and the next burst is a new paragraph.
          setItems((list) => [
            ...list.map((it) => (it.kind === "assistant" ? { ...it, live: false } : it)),
            { kind: "tool", run: ev.call, running: true },
          ]);
        } else if (ev.type === "approval") {
          pendingId.current = ev.request.id;
          setItems((list) => [...list, { kind: "approval", request: ev.request }]);
        } else if (ev.type === "tool_end") {
          setItems((list) => list.map((it) =>
            it.kind === "tool" && it.run.id === ev.run.id
              ? { kind: "tool", run: ev.run, running: false }
              : it));
        } else if (ev.type === "done") {
          const note =
            `${ev.steps} step${ev.steps === 1 ? "" : "s"} · ${ev.ttft}ms to first token · ` +
            `${(ev.ms / 1000).toFixed(1)}s · ${ev.usage.input} in · ${ev.usage.output} out · ${usd(ev.usd)}` +
            (ev.interrupted ? " · ⨯ interrupted" : "") +
            (ev.hitStepLimit ? ` · ⨯ hit the ${ev.state.maxSteps}-step limit` : "");
          setItems((list) => {
            const i = list.map((x) => x.kind).lastIndexOf("assistant");
            if (i === -1) return [...list, { kind: "system", text: "(no reply)" }];
            const copy = [...list];
            copy[i] = { ...(copy[i] as any), live: false, note };
            return copy;
          });
          setState(ev.state);
        } else if (ev.type === "error") {
          setItems((list) => [...list, { kind: "system", text: `error: ${ev.message}` }]);
          setState(ev.state);
        }
      }
    }

    pendingId.current = null;
    setItems((list) => list.map((it) => (it.kind === "assistant" ? { ...it, live: false } : it)));
    setBusy(false);
  }

  async function submit() {
    const line = input.trim();
    if (!line || busy) return;
    setInput("");

    if (line.startsWith("/")) {
      const res = await fetch("/api/command", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ line }),
      }).then((r) => r.json());

      if (res.type === "unknown") {
        setItems((l) => [...l, { kind: "system", text: `/${res.name} is not a command — try /help` }]);
        return;
      }
      if (res.type === "handled") {
        if (line.startsWith("/clear")) setItems([]);
        else if (res.output) setItems((l) => [...l, { kind: "system", text: res.output }]);
        setState(res.state);
        return;
      }
      if (res.type === "prompt") { await runTurn(res.text, line); return; }
    }
    await runTurn(line, line);
  }

  const stop = () => fetch("/api/interrupt", { method: "POST" });

  async function reset() {
    const s = await fetch("/api/reset", { method: "POST" }).then((r) => r.json());
    setState(s);
    setItems([]);
  }

  const matches = input.startsWith("/")
    ? commands.filter((c) => ("/" + c.name).startsWith(input.split(" ")[0]))
    : [];
  const m = state?.meter;
  const waiting = items.some((it) => it.kind === "approval" && !it.answer);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <div className="logo">›_</div>
          <div>
            <h1>mycode <span className="ver">v0.2</span></h1>
            <p>Week 5 · tool use — six tools, six guards, one permission gate</p>
          </div>
        </div>
        <div className="pills">
          <span className="pill" title="the agent's working directory — its blast radius">
            {state?.workspace?.split("/").slice(-2).join("/") ?? "…"}
          </span>
          <span className="pill">{state?.model ?? "…"}</span>
          <span className={"pill " + (waiting ? "waiting" : busy ? "live" : "")}>
            {waiting ? "waiting for you" : busy ? (step ? `step ${step}` : "thinking…") : "idle"}
          </span>
          <span className="pill money">{usd(m?.totalUSD ?? 0)}</span>
        </div>
      </header>

      <main>
        <section className="chat" ref={scroller}>
          {items.length === 0 && (
            <div className="empty">
              <p>Ask it to fix something, or type <code>/help</code>.</p>
              <p className="dim">
                It is working in <code>{state?.workspace}</code>. Reads and searches happen
                silently; anything that writes a file or runs a command stops and asks you first.
              </p>
              <p className="dim">
                Try: <em>“run the tests with node --test --experimental-strip-types utils.test.ts,
                then fix whatever fails.”</em>
              </p>
            </div>
          )}

          {items.map((it, i) => {
            if (it.kind === "tool") return <ToolCall key={i} run={it.run} running={it.running} />;
            if (it.kind === "approval") {
              return (
                <Approval key={i} request={it.request} answer={it.answer}
                  onAnswer={(choice) => answer(it.request.id, choice)} />
              );
            }
            return (
              <div key={i} className={`bubble ${it.kind}`}>
                <div className="who">{it.kind}</div>
                <div className="body">
                  <Markdown text={it.text} />
                  {it.kind === "assistant" && it.live && <span className="caret" />}
                </div>
                {it.kind === "assistant" && it.note && <div className="note">{it.note}</div>}
              </div>
            );
          })}

          {busy && !waiting && items[items.length - 1]?.kind !== "assistant" && (
            <div className="bubble assistant"><div className="body"><span className="spinner">working</span></div></div>
          )}
        </section>

        <aside className="rail">
          <h2>tools</h2>
          <ul className="tools">
            {state?.tools.map((t) => (
              <li key={t.name} title={t.description}>
                <code>{t.name}</code>
                <span className={`kind ${t.safe ? "local" : "prompt"}`}>{t.safe ? "auto" : "asks"}</span>
              </li>
            ))}
          </ul>
          <p className="dim">
            <b>auto</b> = read-only, never interrupts you. <b>asks</b> = a human approves
            every call, unless you have said “always”.
          </p>

          <h2>allowlisted</h2>
          {state?.allowlist.length ? (
            <ul className="allow">
              {state.allowlist.map((k) => <li key={k}><code>{k.replace("run_bash:", "$ ")}</code></li>)}
            </ul>
          ) : <p className="dim">nothing yet — everything still asks</p>}

          <h2>cost meter</h2>
          {m && m.turns > 0 ? (
            <>
              <table>
                <tbody>
                  <tr><td>input</td><td className="n">{m.total.input}</td><td className="n">{usd(m.breakdown.input)}</td></tr>
                  <tr><td>cached</td><td className="n">{m.total.cachedInput}</td><td className="n">{usd(m.breakdown.cachedInput)}</td></tr>
                  <tr><td>output</td><td className="n">{m.total.output}</td><td className="n">{usd(m.breakdown.output)}</td></tr>
                  <tr className="total"><td>total</td><td /><td className="n">{usd(m.totalUSD)}</td></tr>
                </tbody>
              </table>
              <p className="dim">
                {m.turns} turn{m.turns === 1 ? "" : "s"} · {usd(m.totalUSD / m.turns)}/turn.
                An agent turn is several model calls, so it costs several replies.
              </p>
            </>
          ) : <p className="dim">no turns yet</p>}

          <h2>commands</h2>
          <ul className="cmds">
            {commands.map((c) => (
              <li key={c.name} onClick={() => setInput("/" + c.name + " ")}>
                <code>/{c.name}</code>
                <span className={`kind ${c.kind}`}>{c.kind}</span>
                <span className="desc">{c.description}</span>
              </li>
            ))}
          </ul>
          <button className="ghost" onClick={reset}>reset session</button>
        </aside>
      </main>

      <footer>
        {matches.length > 0 && (
          <div className="palette">
            {matches.map((c) => (
              <button key={c.name} onClick={() => setInput("/" + c.name + " ")}>
                /{c.name} <span className="desc">{c.description}</span>
              </button>
            ))}
          </div>
        )}
        <div className="composer">
          <textarea
            value={input}
            placeholder={waiting ? "the agent is waiting for your answer above" : busy ? "working… Esc to stop" : "what should it do? / for a command"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
              if (e.key === "Tab" && matches.length) { e.preventDefault(); setInput("/" + matches[0].name + " "); }
              if (e.key === "Escape" && busy) stop();
            }}
          />
          {busy
            ? <button className="stop" onClick={stop}>■ Stop <kbd>Esc</kbd></button>
            : <button className="send" onClick={submit} disabled={!input.trim()}>Send <kbd>⏎</kbd></button>}
        </div>
      </footer>
    </div>
  );
}
