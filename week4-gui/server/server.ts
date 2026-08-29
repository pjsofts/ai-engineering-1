// server.ts — the Week 4 GUI backend.
//
// The entire point of this folder: it imports week4-workshop/part5-cost/
// session.ts and commands.ts WITHOUT MODIFYING THEM, and renders the same
// agent in a browser. Same conversation object, same cost meter, same
// AbortController-based interrupt.
//
// If you can do this, the split between the agent core and the interface is
// real. If you cannot, you have a terminal program with an agent trapped
// inside it. That is the lesson of Week 4, expressed as an import statement.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));   // week4-gui/
const WORKSHOP = path.resolve(ROOT, "../week4-workshop");
const CLIENT_DIST = path.join(ROOT, "client", "dist");
const PORT = Number(process.env.PORT ?? 3477);

// Load the API key from the workshop .env — the same file the CLI parts use.
const envFile = path.join(WORKSHOP, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// ---- the unmodified workshop core ---------------------------------------
const { Session } = await import(pathToFileURL(path.join(WORKSHOP, "part5-cost/session.ts")).href);
const { MODEL } = await import(pathToFileURL(path.join(WORKSHOP, "part5-cost/model.ts")).href);
const { COMMANDS, dispatch } = await import(pathToFileURL(path.join(WORKSHOP, "part5-cost/commands.ts")).href);
const { getModelCosts, tokensToUSD } = await import(pathToFileURL(path.join(WORKSHOP, "part5-cost/cost.ts")).href);

type AnySession = InstanceType<typeof Session>;
let session: AnySession = new Session();

// ---- helpers -------------------------------------------------------------
// The workshop's `render` commands return ANSI-styled strings, because their
// renderer is a terminal. In the browser we strip the codes and let the client
// draw /help, /status and /cost as real UI. This is exactly why Claude Code
// gives render-style commands their own kind ('local-jsx'): the OUTPUT of a
// command is interface-specific even when its logic is not.
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
    prices: costs,
    pricesKnown: known,
    // Skip the system prompt — the UI shows the conversation, not the config.
    messages: session.messages.slice(1).map((msg: any) => ({
      role: msg.role,
      content: typeof msg.content === "string" ? msg.content : "",
    })),
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

function commandContext() {
  return { messages: session.messages, meter: session.meter, quit: () => {} };
}

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
      session = new Session();
      return json(res, state());
    }

    if (route === "/api/interrupt" && req.method === "POST") {
      return json(res, { interrupted: session.interrupt() });
    }

    // A slash command. Local and render kinds answer here and never reach the
    // model; prompt kinds come back expanded so the client can POST /api/send.
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

    // The streaming turn. The response is an SSE stream on the POST itself —
    // no separate subscribe channel, because there is exactly one consumer.
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

      // The browser closing the tab must cancel the turn, or we keep paying
      // for tokens nobody will ever read. Same rule as Ctrl+C, different key.
      res.on("close", () => { if (session.busy) session.interrupt(); });

      try {
        const turn = await session.send(String(text ?? ""), {
          onFirstToken: (ms: number) => send({ type: "ttft", ms }),
          onDelta: (delta: string) => send({ type: "delta", text: delta }),
          onUsage: (usage: unknown) => send({ type: "usage", usage }),
        });
        send({ type: "done", interrupted: turn.interrupted, ms: turn.ms, ttft: turn.ttft,
               usage: turn.usage, usd: tokensToUSD(turn.usage, MODEL), state: state() });
      } catch (err) {
        send({ type: "error", message: (err as Error).message, state: state() });
      }
      return res.end();
    }

    // ---- static client ----
    let file = route === "/" ? "/index.html" : route;
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
  console.log(`  model ${MODEL}  ·  core imported from week4-workshop/part5-cost/\n`);
});
