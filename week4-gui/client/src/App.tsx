// App.tsx — the browser front-end for mycode v0.1.
//
// Compare this file with week4-workshop/part5-cost/repl.ts. They are the same
// five ideas in two languages of interface:
//
//   spinner            ↔  <div className="spinner">
//   process.stdout.write(delta)  ↔  setStreaming(s => s + delta)
//   readline completer ↔  the slash-command palette
//   rl.on("SIGINT")    ↔  the Stop button
//   console.log(footer)↔  the cost rail on the right
//
// Neither file knows how to call a model. Both of them ask Session to do it.
import { useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";

interface Meter {
  turns: number;
  total: { input: number; cachedInput: number; output: number };
  last: { input: number; cachedInput: number; output: number };
  totalUSD: number;
  lastUSD: number;
  breakdown: { input: number; cachedInput: number; output: number };
}
interface ServerState {
  model: string;
  busy: boolean;
  prices: { input: number; cachedInput: number; output: number };
  pricesKnown: boolean;
  messages: { role: string; content: string }[];
  meter: Meter;
}
interface CommandInfo { name: string; kind: string; description: string; aliases: string[] }
interface Bubble { role: "user" | "assistant" | "system"; text: string; note?: string }

const usd = (n: number) =>
  n === 0 ? "$0.00" : n < 0.01 ? `$${n.toFixed(5)}` : n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;

export default function App() {
  const [state, setState] = useState<ServerState | null>(null);
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [ttft, setTtft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/state").then((r) => r.json()).then(setState);
    fetch("/api/commands").then((r) => r.json()).then(setCommands);
  }, []);

  // Follow the stream the way a terminal does: always pinned to the bottom.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [bubbles, streaming]);

  const matches = input.startsWith("/")
    ? commands.filter((c) =>
        ("/" + c.name).startsWith(input.split(" ")[0]) ||
        c.aliases.some((a) => ("/" + a).startsWith(input.split(" ")[0])))
    : [];

  async function runTurn(text: string, label?: string) {
    setBusy(true);
    setTtft(null);
    setStreaming("");
    if (label) setBubbles((b) => [...b, { role: "user", text: label }]);

    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!res.body) { setBusy(false); setStreaming(null); return; }

    // Read the SSE stream by hand. `data: {...}\n\n` per event — the exact
    // wire format the OpenAI API uses to talk to our server, forwarded on.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let acc = "";

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
        else if (ev.type === "delta") { acc += ev.text; setStreaming(acc); }
        else if (ev.type === "done") {
          setBubbles((b) => [...b, {
            role: "assistant",
            text: acc,
            note: `${ev.ttft}ms · ${(ev.ms / 1000).toFixed(1)}s · ` +
              `${ev.usage.input} in · ${ev.usage.output} out · ${usd(ev.usd)}` +
              (ev.interrupted ? "  ⨯ interrupted — kept in history" : ""),
          }]);
          setState(ev.state);
        } else if (ev.type === "error") {
          setBubbles((b) => [...b, { role: "system", text: `error: ${ev.message}` }]);
          setState(ev.state);
        }
      }
    }

    setStreaming(null);
    setBusy(false);
  }

  async function submit() {
    const line = input.trim();
    if (!line || busy) return;
    setInput("");

    if (line.startsWith("/")) {
      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ line }),
      }).then((r) => r.json());

      if (res.type === "unknown") {
        setBubbles((b) => [...b, { role: "system", text: `/${res.name} is not a command — try /help` }]);
        return;
      }
      if (res.type === "handled") {
        // /clear also empties the transcript on screen.
        if (line.startsWith("/clear")) setBubbles([]);
        else if (res.output) setBubbles((b) => [...b, { role: "system", text: res.output }]);
        setState(res.state);
        return;
      }
      if (res.type === "prompt") {
        // A prompt command IS a model turn — show what it expanded into.
        await runTurn(res.text, line);
        return;
      }
    }

    await runTurn(line, line);
  }

  async function stop() {
    await fetch("/api/interrupt", { method: "POST" });
  }

  async function reset() {
    const s = await fetch("/api/reset", { method: "POST" }).then((r) => r.json());
    setState(s);
    setBubbles([]);
  }

  const m = state?.meter;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <div className="logo">›_</div>
          <div>
            <h1>mycode <span className="ver">v0.1</span></h1>
            <p>Week 4 · the chat interface — the same core as the terminal REPL</p>
          </div>
        </div>
        <div className="pills">
          <span className="pill">{state?.model ?? "…"}</span>
          <span className={"pill " + (busy ? "live" : "")}>
            {busy ? (ttft ? `streaming · ${ttft}ms to first token` : "thinking…") : "idle"}
          </span>
          <span className="pill money">{usd(m?.totalUSD ?? 0)}</span>
        </div>
      </header>

      <main>
        <section className="chat" ref={scroller}>
          {bubbles.length === 0 && !streaming && (
            <div className="empty">
              <p>Ask something, or type <code>/help</code>.</p>
              <p className="dim">
                Everything here runs <code>week4-workshop/part5-cost/session.ts</code> —
                the same file <code>npm run part5</code> runs in your terminal.
              </p>
            </div>
          )}

          {bubbles.map((b, i) => (
            <div key={i} className={`bubble ${b.role}`}>
              <div className="who">{b.role}</div>
              <div className="body"><Markdown text={b.text} /></div>
              {b.note && <div className="note">{b.note}</div>}
            </div>
          ))}

          {streaming !== null && (
            <div className="bubble assistant">
              <div className="who">assistant</div>
              <div className="body">
                {streaming ? <Markdown text={streaming} /> : <span className="spinner">thinking</span>}
                {streaming && <span className="caret" />}
              </div>
            </div>
          )}
        </section>

        <aside className="rail">
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
                {m.turns} turn{m.turns === 1 ? "" : "s"} · {usd(m.totalUSD / m.turns)}/turn
              </p>
              <p className="dim">
                output is billed at {(state!.prices.output / state!.prices.input).toFixed(0)}× input
              </p>
              {!state!.pricesKnown && <p className="warn">no price on file for this model — estimated</p>}
            </>
          ) : (
            <p className="dim">no turns yet</p>
          )}

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
          <p className="dim">
            <b>local</b> and <b>render</b> never call the model. <b>prompt</b> costs a full turn.
          </p>
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
            placeholder={busy ? "streaming… press Stop to cancel" : "message, or / for a command"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
              if (e.key === "Tab" && matches.length) { e.preventDefault(); setInput("/" + matches[0].name + " "); }
              // Esc is the browser's Ctrl+C.
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
