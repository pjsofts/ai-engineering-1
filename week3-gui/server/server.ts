// server.ts — the Week 3 demo GUI backend. It runs the EXISTING part folders
// in-process (dynamic import), so the GUI shares the same wf/ state and
// events.jsonl as the CLI demos. Events reach the browser live through the
// optional __emitHook in each part's events.ts, streamed over SSE.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // week3-gui/
const WORKSHOP = path.resolve(ROOT, "../week3-workshop");
const CLIENT_DIST = path.join(ROOT, "client", "dist");
const PORT = 3377;

// Load the API key from the workshop .env (same file the CLI uses).
for (const line of fs.readFileSync(path.join(WORKSHOP, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

interface PartDef {
  id: string; dir: string; title: string; blurb: string;
  supervised?: boolean; options?: string[];
}
const PARTS: PartDef[] = [
  { id: "part1", dir: "part1-brittle", title: "1 · The brittle agent",
    blurb: "Week 1's loop wearing a harness jacket. State is an in-memory array — a crash loses everything." },
  { id: "part2", dir: "part2-durable", title: "2 · Durable execution",
    blurb: "Every model turn and tool call is a checkpointed step. Crash, then run again: replay skips completed steps.",
    options: ["crash"] },
  { id: "part3", dir: "part3-sandbox", title: "3 · Sandboxing & code mode",
    blurb: "The model writes programs that run in a vm sandbox with only read tools inside." },
  { id: "part4", dir: "part4-memory", title: "4 · Memory & hydration",
    blurb: "History ≠ state ≠ context. Compaction by token budget; the goal stays pinned." },
  { id: "part5", dir: "part5-handoffs", title: "5 · Routing & handoffs",
    blurb: "Triage cannot refund — it hands off to billing. The harness swaps the agent, not the conversation." },
  { id: "part6", dir: "part6-supervision", title: "6 · Supervision",
    blurb: "Plan → parallel investigators → fan-in → synthesize. One crash degrades gracefully.",
    supervised: true, options: ["chaos"] },
  { id: "part7", dir: "part7-approval", title: "7 · Human-in-the-loop",
    blurb: "issueRefund suspends the workflow until a human decides. The process exits; the wait is a JSON file." },
];
const partById = Object.fromEntries(PARTS.map((p) => [p.id, p]));

// ---------------- SSE fan-out ----------------
type Client = http.ServerResponse;
const clients = new Set<Client>();
function push(msg: Record<string, unknown>): void {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(data);
}

// ---------------- run engine ----------------
class CrashSignal extends Error {}
let busy: string | null = null;   // part id of the active run, or null

interface RunOpts { task?: string; crash?: boolean; chaos?: boolean; resume?: boolean; }

async function importPart(dir: string) {
  const base = path.join(WORKSHOP, dir);
  // durable.ts mkdirs wf/ at import time relative to cwd — import from the
  // part's own folder so that side effect lands in the right place.
  const prev = process.cwd();
  process.chdir(base);
  try {
    const harness = await import(pathToFileURL(path.join(base, "harness.ts")).href);
    const durable = fs.existsSync(path.join(base, "durable.ts"))
      ? await import(pathToFileURL(path.join(base, "durable.ts")).href) : null;
    const supervisor = fs.existsSync(path.join(base, "supervisor.ts"))
      ? await import(pathToFileURL(path.join(base, "supervisor.ts")).href) : null;
    return { harness, durable, supervisor };
  } finally {
    process.chdir(prev);
  }
}

async function runPart(part: PartDef, opts: RunOpts): Promise<void> {
  const prevCwd = process.cwd();
  const realExit = process.exit;
  process.chdir(path.join(WORKSHOP, part.dir));
  (globalThis as any).__emitHook = (event: unknown) =>
    push({ kind: "event", part: part.id, event });
  if (opts.crash) process.env.CRASH_AT_STEP = "2";
  if (opts.chaos) process.env.CHAOS_FAIL = "technical";
  // The Part-2 crash helper calls process.exit(1); in-process we turn that
  // into a catchable signal so the server survives the "crash".
  (process as any).exit = (code?: number) => { throw new CrashSignal(String(code)); };
  try {
    const { harness, durable, supervisor } = await importPart(part.dir);
    const uuid = () => Math.random().toString(16).slice(2, 10);
    const Suspended = durable?.Suspended;

    const replayOne = async (wfId: string) => {
      push({ kind: "status", part: part.id, status: "recovering", detail: wfId });
      const wf = new durable!.Workflow(wfId);
      const fn = wfId.startsWith("sup-") && supervisor
        ? supervisor.supervisorWorkflow : harness.agentWorkflow;
      return fn(wf);
    };

    push({ kind: "status", part: part.id, status: "running",
           detail: opts.resume ? "(resume)" : opts.task ?? "" });

    let reply: string | null = null;
    if (opts.resume) {
      const ids: string[] = durable!.pending();
      if (!ids.length) { push({ kind: "status", part: part.id, status: "done",
                                detail: "nothing to resume" }); return; }
      for (const wfId of ids) reply = await replayOne(wfId);
    } else if (part.id === "part1") {
      reply = await harness.runAgent(opts.task);
    } else if (part.supervised) {
      const wf = new durable!.Workflow(`sup-${uuid()}`, opts.task);
      reply = await supervisor!.supervisorWorkflow(wf);
    } else {
      const wf = new durable!.Workflow(uuid(), opts.task);
      reply = await harness.agentWorkflow(wf);
    }
    push({ kind: "status", part: part.id, status: "done", detail: reply ?? "" });
  } catch (err) {
    const Suspended = (await importPart(part.dir)).durable?.Suspended;
    if (err instanceof CrashSignal) {
      push({ kind: "status", part: part.id, status: "crashed",
             detail: "process died mid-workflow (simulated). Run again to recover." });
    } else if (Suspended && err instanceof Suspended) {
      push({ kind: "status", part: part.id, status: "suspended", detail: err.message });
    } else {
      push({ kind: "status", part: part.id, status: "error", detail: String(err) });
    }
  } finally {
    delete process.env.CRASH_AT_STEP;
    delete process.env.CHAOS_FAIL;
    (process as any).exit = realExit;
    (globalThis as any).__emitHook = undefined;
    process.chdir(prevCwd);
    busy = null;
  }
}

// ---------------- helpers ----------------
function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch { resolve({}); } });
  });
}
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript",
  ".css": "text/css", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

// ---------------- http ----------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/api/stream") {
    res.writeHead(200, { "content-type": "text/event-stream",
      "cache-control": "no-cache", connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ kind: "hello", busy })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (url.pathname === "/api/parts") {
    const samples: Record<string, string> = {};
    for (const p of PARTS) {
      try {
        const h = await importPart(p.dir);
        samples[p.id] = p.supervised
          ? h.harness.SAMPLE_ESCALATION : h.harness.SAMPLE_TASK;
      } catch { samples[p.id] = ""; }
    }
    return json(res, 200, PARTS.map((p) => ({ ...p, sample: samples[p.id] })));
  }
  if (req.method === "POST" && url.pathname === "/api/run") {
    const body = await readBody(req);
    const part = partById[body.part];
    if (!part) return json(res, 400, { error: "unknown part" });
    if (busy) return json(res, 409, { error: `busy: ${busy} is running` });
    busy = part.id;
    void runPart(part, body);          // fire and forget; results go over SSE
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/api/approve") {
    const { part: partId, wfId, approved } = await readBody(req);
    const part = partById[partId];
    if (!part || !wfId) return json(res, 400, { error: "need part + wfId" });
    const base = path.join(WORKSHOP, part.dir);
    fs.mkdirSync(path.join(base, "decisions"), { recursive: true });
    fs.writeFileSync(path.join(base, "decisions", `${wfId}.json`),
      JSON.stringify({ approved: !!approved }));
    const wfPath = path.join(base, "wf", `${wfId}.json`);
    const state = JSON.parse(fs.readFileSync(wfPath, "utf8"));
    state.status = "running";
    fs.writeFileSync(wfPath, JSON.stringify(state));
    push({ kind: "status", part: part.id, status: "decided",
           detail: approved ? "approved — resume to continue" : "denied — resume to continue" });
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/api/reset") {
    const { part: partId } = await readBody(req);
    const targets = partId ? [partById[partId]] : PARTS;
    for (const p of targets) {
      if (!p) continue;
      const base = path.join(WORKSHOP, p.dir);
      fs.rmSync(path.join(base, "wf"), { recursive: true, force: true });
      fs.rmSync(path.join(base, "decisions"), { recursive: true, force: true });
      fs.rmSync(path.join(base, "events.jsonl"), { force: true });
      fs.mkdirSync(path.join(base, "wf"), { recursive: true }); // durable.ts made it at import time
    }
    push({ kind: "status", part: partId ?? "all", status: "reset", detail: "" });
    return json(res, 200, { ok: true });
  }
  // static client
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  const full = path.join(CLIENT_DIST, path.normalize(file));
  if (full.startsWith(CLIENT_DIST) && fs.existsSync(full) && fs.statSync(full).isFile()) {
    res.writeHead(200, { "content-type": MIME[path.extname(full)] ?? "application/octet-stream" });
    return void res.end(fs.readFileSync(full));
  }
  res.writeHead(404); res.end("not found");
});
server.listen(PORT, "127.0.0.1", () =>
  console.log(`Week 3 demo GUI → http://127.0.0.1:${PORT}`));
