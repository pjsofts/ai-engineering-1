import React, { useEffect, useState } from "react";

// The Jev benchmark view: reads part2-jev/bench/results/latest.json via
// /api/bench and renders speed, accuracy, the threshold sweep, and every case.
export interface BenchProgress { status: "running" | "done" | "error";
  done?: number; total?: number; label?: string; detail?: string }

const pct = (x: number) => `${Math.round(x * 100)}%`;
const SYS_LABEL: Record<string, string> = { jev: "Jev", llm: "LLM" };

const METRICS: [string, string, string][] = [
  ["category", "Category accuracy", "job 1: picked the right team"],
  ["articles_exact", "Articles: exact set", "job 2: no missing and no wrong article"],
  ["articles_precision", "Articles: precision", "picked articles that were allowed"],
  ["articles_recall", "Articles: recall", "needed articles that were picked"],
  ["grounded", "Grounded accuracy", "job 3: 'facts backed by KB?' matched label"],
  ["on_topic", "On-topic accuracy", "job 3: 'answers the customer?' matched label"],
  ["gate_decision", "Send/block decision", "the action the harness takes"],
  ["bad_drafts_caught", "Bad drafts blocked", "safety: bad draft never reaches customer"],
  ["good_drafts_passed", "Good drafts sent", "usefulness: no needless redrafts"],
];

export default function Bench({ progress, busy }: { progress: BenchProgress | null; busy: string | null }) {
  const [r, setR] = useState<any>(null);
  const [missesOnly, setMissesOnly] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = () => fetch("/api/bench").then((x) => x.ok ? x.json() : null).then(setR);
  useEffect(() => { load(); }, []);
  useEffect(() => { if (progress?.status === "done") load(); }, [progress?.status]);

  async function run(jevOnly: boolean) {
    setErr(null);
    const x = await fetch("/api/bench", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ jevOnly }) });
    if (!x.ok) setErr((await x.json()).error);
  }
  const running = progress?.status === "running";
  const sys: string[] = r?.systems ?? [];

  return (
    <div className="bench">
      <section className="controls">
        <p className="blurb">Runs {r ? `${r.n.triage} triage + ${r.n.verify} draft-check` : "the"} hand-labelled
          cases (<code>part2-jev/bench/dataset.ts</code>) through Jev, and through {r?.llm_model ?? "gpt-4o-mini"} asked
          the <i>same questions</i> via structured output. Speed is wall-clock per call after a warm-up,
          {" "}{r?.concurrency ?? 4} calls in flight.</p>
        <div className="row opts bench-run">
          <button className="primary" disabled={!!busy} onClick={() => run(false)}>
            {running ? <span className="spinner light" /> : "▶"} Run Jev vs LLM</button>
          <button disabled={!!busy} onClick={() => run(true)}>Run Jev only</button>
          {running && progress?.total ? (
            <span className="bprog"><span className="jbar"><span className="jfill strong"
              style={{ width: pct(progress.done! / progress.total) }} /></span>
              {progress.done}/{progress.total} · {progress.label}</span>)
            : running ? <span className="bprog">{progress?.label}</span> : null}
          {(err || progress?.status === "error") && <span className="warn">{err ?? progress?.detail}</span>}
          {r && <span className="pill">last run {new Date(r.ran_at).toLocaleString()}</span>}
        </div>
      </section>

      {!r ? <div className="empty">No results yet. Press <b>Run Jev vs LLM</b> (about a minute).</div> : (
      <div className="bench-body">
        {/* ---------- speed ---------- */}
        <section className="panel">
          <h2>⏱ Speed: latency per call</h2>
          <div className="bpad">
            <div className="tiles">
              {sys.map((s) => (
                <div key={s} className={`tile ${s}`}>
                  <div className="tlabel">{SYS_LABEL[s]} median</div>
                  <div className="tnum">{r.summary[s].latency_ms.all.p50}<small> ms</small></div>
                  <div className="tsub">p95 {r.summary[s].latency_ms.all.p95} ms</div>
                </div>))}
              {r.summary.llm && (
                <div className="tile">
                  <div className="tlabel">Jev speed-up (median)</div>
                  <div className="tnum">{(r.summary.llm.latency_ms.all.p50 / r.summary.jev.latency_ms.all.p50).toFixed(1)}<small>×</small></div>
                  <div className="tsub">p95: {(r.summary.llm.latency_ms.all.p95 / r.summary.jev.latency_ms.all.p95).toFixed(1)}×</div>
                </div>)}
            </div>
            <LatencyBars r={r} />
            <p className="bnote">Tokens per call: {sys.map((s) =>
              `${SYS_LABEL[s]} ${Math.round(r.summary[s].tokens.triage)} (triage) / ${Math.round(r.summary[s].tokens.verify)} (check)`).join(" · ")}.
              {" "}Different tokenizers and pricing, so compare cost from your bills, not from this.</p>
          </div>
        </section>

        {/* ---------- accuracy ---------- */}
        <section className="panel">
          <h2>🎯 Accuracy vs hand labels <span className="count">thresholds: article ≥ {r.thresholds.article}, gate ≥ {r.thresholds.gate}</span></h2>
          <div className="bpad">
            <table className="btable">
              <thead><tr><th>metric</th>{sys.map((s) => <th key={s} className="num">{SYS_LABEL[s]}</th>)}<th>what it means</th></tr></thead>
              <tbody>{METRICS.map(([k, name, what]) => {
                const vals = sys.map((s) => r.summary[s].accuracy[k] as number);
                const best = Math.max(...vals);
                return (<tr key={k}><td>{name}</td>
                  {vals.map((v, i) => <td key={i} className={`num ${sys.length > 1 && v === best && vals.some((w) => w !== best) ? "best" : ""}`}>{pct(v)}</td>)}
                  <td className="dim">{what}</td></tr>);
              })}</tbody>
            </table>
            {r.brier && <p className="bnote">Jev Brier score (how good its <i>probabilities</i> are; 0 = perfect, 0.25 = coin flip):
              articles <b>{r.brier.articles.toFixed(3)}</b>, draft check <b>{r.brier.gate.toFixed(3)}</b>.
              The LLM returns labels only, so it has no Brier score and no threshold to tune.</p>}
          </div>
        </section>

        {/* ---------- threshold sweep ---------- */}
        {r.sweep && (
        <section className="panel">
          <h2>🎚 Jev threshold sweep: the policy knob lives in code</h2>
          <div className="bpad">
            <table className="btable">
              <thead><tr><th className="num">threshold</th><th className="num">articles exact</th>
                <th className="num">send/block right</th><th className="num">bad drafts blocked</th><th className="num">good drafts sent</th></tr></thead>
              <tbody>{r.sweep.map((w: any) => (
                <tr key={w.threshold} className={w.threshold === r.thresholds.gate ? "current" : ""}>
                  <td className="num">{w.threshold.toFixed(1)}{w.threshold === r.thresholds.gate ? " ◂ current" : ""}</td>
                  <td className="num">{pct(w.articles_exact)}</td><td className="num">{pct(w.gate_decision)}</td>
                  <td className="num">{pct(w.bad_drafts_caught)}</td><td className="num">{pct(w.good_drafts_passed)}</td></tr>))}</tbody>
            </table>
            <p className="bnote">Re-scored from the same answers: moving a threshold needs no new Jev calls.
              With only {r.n.verify} draft cases, don't pick a threshold off this table. Add cases first.</p>
          </div>
        </section>)}

        {/* ---------- cases ---------- */}
        <section className="panel">
          <h2>🔎 Every case
            <label className="count miss-toggle"><input type="checkbox" checked={missesOnly}
              onChange={(e) => setMissesOnly(e.target.checked)} /> misses only</label></h2>
          <div className="bpad">
            <h3 className="bh3">Triage (jobs 1 + 2)</h3>
            <table className="btable cases">
              <thead><tr><th>case</th><th>message</th><th>gold</th>{sys.map((s) => <th key={s}>{SYS_LABEL[s]}</th>)}</tr></thead>
              <tbody>{r.cases.triage.filter((c: any) => !missesOnly ||
                sys.some((s) => !(c.results[s].category_ok && c.results[s].articles_ok))).map((c: any) => (
                <tr key={c.id}>
                  <td><b>{c.id}</b><div className="tag">{c.tag}</div></td>
                  <td className="msg">{c.text}</td>
                  <td>{c.category}{c.alsoOk?.length ? <span className="dim"> / {c.alsoOk.join(", ")}</span> : ""}
                    <div className="dim">need: {c.need.join(", ") || "none"}{c.ok?.length ? ` · ok: ${c.ok.join(", ")}` : ""}</div></td>
                  {sys.map((s) => { const x = c.results[s]; return (
                    <td key={s} className={x.category_ok && x.articles_ok ? "hit" : "miss"}>
                      {x.category_ok ? "✓" : "✗"} {x.category}
                      <div>{x.articles_ok ? "✓" : "✗"} {x.picked.join(", ") || "no articles"}</div>
                      <div className="dim probs">{Object.entries(x.answers).filter(([k]) => k.startsWith("kb_"))
                        .map(([k, v]) => `${k.slice(3)} ${s === "jev" ? pct(Number(v)) : v ? "yes" : "no"}`).join(" · ")}</div>
                      <div className="dim">{x.latency_ms} ms</div></td>); })}
                </tr>))}</tbody>
            </table>
            <h3 className="bh3">Draft check (job 3)</h3>
            <table className="btable cases">
              <thead><tr><th>case</th><th>customer → draft</th><th>gold</th>{sys.map((s) => <th key={s}>{SYS_LABEL[s]}</th>)}</tr></thead>
              <tbody>{r.cases.verify.filter((c: any) => !missesOnly ||
                sys.some((s) => !(c.results[s].grounded_ok && c.results[s].on_topic_ok))).map((c: any) => (
                <tr key={c.id}>
                  <td><b>{c.id}</b><div className="tag">{c.tag}</div></td>
                  <td className="msg"><div className="dim">“{c.customer}” · KB: {c.topics.join(", ") || "none"}</div>{c.draft}</td>
                  <td>grounded {c.grounded ? "yes" : "no"}<br />on-topic {c.on_topic ? "yes" : "no"}
                    <div className="dim">{c.grounded && c.on_topic ? "should send" : "should block"}</div></td>
                  {sys.map((s) => { const x = c.results[s]; const a = x.answers; return (
                    <td key={s} className={x.grounded_ok && x.on_topic_ok ? "hit" : x.decision_ok ? "partial" : "miss"}>
                      {x.grounded_ok ? "✓" : "✗"} grounded {s === "jev" ? pct(a.grounded) : a.grounded ? "yes" : "no"}<br />
                      {x.on_topic_ok ? "✓" : "✗"} on-topic {s === "jev" ? pct(a.on_topic) : a.on_topic ? "yes" : "no"}
                      <div className={x.decision_ok ? "dim" : "warn"}>→ {x.blocked ? "block" : "send"}{x.decision_ok ? "" : " (wrong action)"}</div>
                      <div className="dim">{x.latency_ms} ms</div></td>); })}
                </tr>))}</tbody>
            </table>
          </div>
        </section>
      </div>)}
    </div>
  );
}

// Horizontal bars, one row per (job × system); a single shared ms scale so
// lengths compare honestly. Legend + direct value labels: identity is never color-only.
function LatencyBars({ r }: { r: any }) {
  const sys: string[] = r.systems;
  const jobs: [string, string][] = [["triage", "triage (5 questions)"], ["verify", "draft check (2 questions)"]];
  const max = Math.max(...sys.flatMap((s) => jobs.map(([j]) => r.summary[s].latency_ms[j].p95)));
  return (
    <div className="lbars">
      <div className="legend">{sys.map((s) => <span key={s}><i className={`sw ${s}`} />{SYS_LABEL[s]}</span>)}
        <span><i className="sw p95" />bar = median, whisker = p95</span></div>
      {jobs.map(([j, label]) => (
        <div key={j} className="lgroup">
          <div className="lglabel">{label}</div>
          {sys.map((s) => { const l = r.summary[s].latency_ms[j]; return (
            <div key={s} className="lrow" title={`${SYS_LABEL[s]} ${label}: median ${l.p50} ms, p95 ${l.p95} ms, mean ${l.mean} ms, max ${l.max} ms`}>
              <span className="lname">{SYS_LABEL[s]}</span>
              <span className="ltrack">
                <span className={`lfill ${s}`} style={{ width: `${(l.p50 / max) * 100}%` }} />
                <span className="lwhisk" style={{ left: `${(l.p50 / max) * 100}%`, width: `${((l.p95 - l.p50) / max) * 100}%` }} />
              </span>
              <span className="lval">{l.p50} ms <span className="dim">/ {l.p95}</span></span>
            </div>); })}
        </div>))}
    </div>
  );
}
