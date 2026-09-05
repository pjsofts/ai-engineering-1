// server.ts — the Week 5 GUI backend.
//
// The entire point of this folder is the three imports below: it loads
// week5-workshop/part5-agent/session.ts, commands.ts and permissions.ts
// WITHOUT MODIFYING THEM, and renders the same agent in a browser. Same tools,
// same six guards, same permission ladder, same cost meter.
//
// One thing genuinely is harder here than in the terminal, and it is worth the
// whole week: APPROVAL. In the REPL, `approve` is `rl.question` — the agent
// blocks on a keypress. In a browser there is no keypress to block on; there is
// an HTTP request that has to travel to a client, wait for a human to look at a
// diff, and travel back. So the handler creates a promise, parks its `resolve`
// in a map, and streams the question to the client. The agent sits on that
// promise until POST /api/approve calls the resolver.
//
// That is the shape of every human-in-the-loop system you will ever build.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));   // week5-gui/
const WORKSHOP = path.resolve(ROOT, "../week5-workshop");
const CLIENT_DIST = path.join(ROOT, "client", "dist");
const PORT = Number(process.env.PORT ?? 3478);

// Load the API key from the workshop .env — the same file the CLI parts use.
const envFile = path.join(WORKSHOP, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// WHERE THE AGENT WORKS is a decision, not an accident. The tools resolve paths
// against process.cwd(), so the directory this process starts in is the blast
// radius. Default to the workshop sandbox; opt into something real explicitly:
//
//     WORKSPACE=~/code/my-project npm run gui
const WORKSPACE = path.resolve(process.env.WORKSPACE ?? path.join(WORKSHOP, "sandbox"));
if (!fs.existsSync(WORKSPACE)) fs.cpSync(path.join(WORKSHOP, "fixture"), WORKSPACE, { recursive: true });
process.chdir(WORKSPACE);

// ---- the unmodified workshop core ---------------------------------------
const PART = path.join(WORKSHOP, "part5-agent");
const load = (file: string) => import(pathToFileURL(path.join(PART, file)).href);

const { Session, MAX_STEPS } = await load("session.js");
const { MODEL } = await load("model.js");
const { COMMANDS, dispatch } = await load("commands.js");
const { getModelCosts, tokensToUSD } = await load("cost.js");
const { SAFE_TOOLS } = await load("tools/permissions.js");
const { TOOL_SPECS } = await load("tools/specs.js");

type AnySession = InstanceType<typeof Session>;
let session: AnySession = new Session();

// ---- pending approvals ---------------------------------------------------
// id -> the resolver of the promise the agent is currently blocked on.
const pending = new Map<string, (answer: "yes" | "always" | "no") => void>();

/** Answer every outstanding question with "no". Used when the client vanishes. */
function denyAllPending(): void {
  for (const [, resolve] of pending) resolve("no");
  pending.clear();
}

// ---- helpers -------------------------------------------------------------
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
  });
}

function json(res: http.ServerResponse, body: unknown, code = 200): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function state() {
  const m = session.meter;
  const { costs, known } = getModelCosts(MODEL);
  return {
    model: MODEL,
    busy: session.busy,
    workspace: process.cwd(),
    maxSteps: MAX_STEPS,
    prices: costs,
    pricesKnown: known,
    allowlist: [...session.allowlist],
    tools: TOOL_SPECS.map((t: any) => ({
      name: t.function.name,
      safe: SAFE_TOOLS.has(t.function.name),
      description: t.function.description,
    })),
    // Skip the system prompt, and skip the tool plumbing: the browser shows the
    // conversation, and tool receipts are streamed as their own events.
    messages: session.messages.slice(1)
      .filter((msg: any) => msg.role === "user" || (msg.role === "assistant" && msg.content))
      .map((msg: any) => ({ role: msg.role, content: String(msg.content ?? "") })),
    meter: {
      turns: m.turns,
      total: m.total,
      last: m.last,
      totalUSD: m.totalUSD,
      lastUSD: m.lastUSD,
      breakdown: {
        input: (m.total.input * costs.input) / 1_000_000,
        cachedInput: (m.total.cachedInput * costs.cachedInput) / 1_000_000,
        output: (m.total.output * costs.output) / 1_000_000,
      },
    },
  };
}

const commandContext = () => ({
  messages: session.messages,
  meter: session.meter,
  allowlist: session.allowlist,
  quit: () => {},
});

// ---- routes --------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const route = url.pathname;

  try {
    if (route === "/api/state") return json(res, state());

    if (route === "/api/commands") {
      return json(res, COMMANDS.map((c: any) => ({
        name: c.name, kind: c.kind, description: c.description, aliases: c.aliases ?? [],
      })));
    }

    if (route === "/api/reset" && req.method === "POST") {
      session.interrupt();
      denyAllPending();
      session = new Session();
      return json(res, state());
    }

    if (route === "/api/interrupt" && req.method === "POST") {
      // Stop means stop: cancel the model call AND answer any open question,
      // or the agent would sit forever on a promise nobody will resolve.
      denyAllPending();
      return json(res, { interrupted: session.interrupt() });
    }

    // The answer to one permission question. The agent is asleep on a promise
    // in the map; this wakes it up.
    if (route === "/api/approve" && req.method === "POST") {
      const { id, choice } = await readBody(req);
      const resolve = pending.get(String(id));
      if (!resolve) return json(res, { ok: false, error: "no such pending approval" }, 404);
      pending.delete(String(id));
      resolve(choice === "yes" || choice === "always" ? choice : "no");
      return json(res, { ok: true });
    }

    if (route === "/api/command" && req.method === "POST") {
      const { line } = await readBody(req);
      const result = dispatch(String(line ?? ""), commandContext());
      if (!result) return json(res, { type: "none" });
      if (result.type === "handled") {
        return json(res, { type: "handled", output: result.output ? stripAnsi(result.output) : "", state: state() });
      }
      if (result.type === "prompt") return json(res, { type: "prompt", text: result.text });
      return json(res, { type: "unknown", name: result.name });
    }

    // The streaming turn. SSE on the POST itself — there is exactly one
    // consumer, so there is no reason for a separate subscribe channel.
    if (route === "/api/send" && req.method === "POST") {
      const { text, label } = await readBody(req);
      if (session.busy) return json(res, { error: "a turn is already running" }, 409);

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      send({ type: "start", label: label ?? text });

      // A closed tab must cancel the turn and answer every open question, or we
      // keep paying for tokens nobody will read and leak a hanging promise.
      res.on("close", () => {
        if (session.busy) session.interrupt();
        denyAllPending();
      });

      try {
        const turn = await session.send(String(text ?? ""), {
          onFirstToken: (ms: number) => send({ type: "ttft", ms }),
          onDelta: (delta: string) => send({ type: "delta", text: delta }),
          onUsage: (usage: unknown) => send({ type: "usage", usage }),
          onStep: (step: number) => send({ type: "step", step }),
          onToolStart: (call: any) => send({ type: "tool_start", call }),
          onToolEnd: (run: any) => send({
            type: "tool_end",
            run: {
              ...run,
              // The model gets the whole result; the browser gets the first
              // 2,000 characters of it. Same rule as the terminal's one-line
              // receipt, just with more room.
              result: String(run.result).slice(0, 2000),
            },
          }),

          // Here it is: the agent blocks on a promise that only an HTTP request
          // can resolve.
          approve: (request: any) => new Promise((resolve) => {
            pending.set(request.id, resolve);
            send({ type: "approval", request });
          }),
        });

        send({
          type: "done",
          interrupted: turn.interrupted, hitStepLimit: turn.hitStepLimit,
          steps: turn.steps, ms: turn.ms, ttft: turn.ttft,
          usage: turn.usage, usd: tokensToUSD(turn.usage, MODEL), state: state(),
        });
      } catch (err) {
        send({ type: "error", message: (err as Error).message, state: state() });
      }
      denyAllPending();
      return res.end();
    }

    // ---- static client ----
    const file = route === "/" ? "/index.html" : route;
    const abs = path.join(CLIENT_DIST, path.normalize(file).replace(/^(\.\.[/\\])+/, ""));
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const types: Record<string, string> = {
        ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
        ".svg": "image/svg+xml", ".json": "application/json",
      };
      res.writeHead(200, { "content-type": types[path.extname(abs)] ?? "application/octet-stream" });
      return fs.createReadStream(abs).pipe(res);
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end(fs.existsSync(CLIENT_DIST) ? "not found" : "client not built — run: npm run build");
  } catch (err) {
    json(res, { error: (err as Error).message }, 500);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  mycode gui  ·  http://127.0.0.1:${PORT}`);
  console.log(`  model ${MODEL}  ·  core imported from week5-workshop/part5-agent/`);
  console.log(`  workspace ${process.cwd()}\n`);
});
