"""Runs a week 7 step and streams what it does to the browser.

The code in rag/ stays plain Python. This server watches it run with
sys.settrace: every function call, every line, every embedding and LLM call
becomes an event, sent to the page over Server-Sent Events. Some return values
(chunks, vectors, search scores, index reports) are also sent as "views" so the
page can draw them. Nothing here is shown to the audience.

    python server.py            # then open http://127.0.0.1:8766
"""
import importlib
import json
import os
import queue
import re
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from itertools import count
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).parent
CODE = ROOT / "rag"
UI = ROOT / "ui"
sys.path.insert(0, str(CODE))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

try:
    import llm  # noqa: E402  (patched below, before any step imports it)
except Exception:  # no API key: replay still works
    os.environ["OPENAI_API_KEY"] = "missing"
    import llm  # noqa: E402
HAS_KEY = os.environ.get("OPENAI_API_KEY") != "missing"
LIVE_EMBED_MODEL = llm.EMBED_MODEL

import catalog  # noqa: E402
import replay  # noqa: E402

PORT = int(os.environ.get("PORT", 8766))
SPEEDS = {  # seconds to pause: per traced line, per replayed LLM call, per replayed embedding call
    "slow": (0.35, 1.8, 0.6),
    "normal": (0.12, 1.0, 0.3),
    "fast": (0.0, 0.3, 0.05),
}
SLOW_REPEATS = 3          # a line that runs more often than this is fast-forwarded
QUIET = {"dot", "length"}  # tiny maths helpers: called thousands of times, not traced inside
RELOAD = ["vectors", "chunking", "store", "indexer", "tools"]  # in dependency order
TEXT_LIMIT = 4000


class StopRun(Exception):
    pass


# ---------------------------------------------------------------- showing values

def is_vector(value):
    return isinstance(value, list) and len(value) > 8 and all(isinstance(x, float) for x in value[:8])


def chunk_label(chunk):
    label = f"{chunk.get('path')}:{chunk.get('start')}-{chunk.get('end')}"
    return label + (f"  (score {chunk['score']})" if "score" in chunk else "")


def is_chunk(value):
    return isinstance(value, dict) and "path" in value and "start" in value


def short(value, limit=TEXT_LIMIT):
    """A readable one-glance version of a value: vectors and stores are summarised."""
    if is_vector(value):
        head = ", ".join(f"{x:.3f}" for x in value[:4])
        text = f"vector of {len(value)} numbers [{head}, …]"
    elif isinstance(value, list) and value and all(is_vector(v) for v in value):
        text = f"{len(value)} vectors × {len(value[0])} numbers"
    elif isinstance(value, dict) and "chunks" in value and "files" in value:
        text = f"store: {len(value['chunks'])} chunks from {len(value['files'])} files"
    elif is_chunk(value):
        text = chunk_label(value)
    elif isinstance(value, list) and value and all(is_chunk(v) for v in value):
        text = f"{len(value)} chunks:\n" + "\n".join(chunk_label(c) for c in value[:12])
        if len(value) > 12:
            text += f"\n… {len(value) - 12} more"
    elif isinstance(value, dict) and set(value) == {"embedded", "unchanged", "deleted"}:
        text = ", ".join(f"{key} {len(files)}" for key, files in value.items())
    else:
        text = value if isinstance(value, str) else repr(value)
    return text if len(text) <= limit else text[:limit] + " …"


def show_reply(reply):
    if isinstance(reply, llm.Reply):
        calls = [f"{call.name}({', '.join(f'{k}={v!r}' for k, v in call.args.items())})"
                 for call in reply.tool_calls]
        return {"text": reply.text, "tool_calls": calls}
    return {"text": str(reply), "tool_calls": []}


def show_messages(messages):
    shown = []
    for message in messages:
        item = {"role": message.get("role"), "content": short(message.get("content") or "")}
        if message.get("tool_calls"):
            item["tool_calls"] = [f"{c['function']['name']}({c['function']['arguments']})"
                                  for c in message["tool_calls"]]
        shown.append(item)
    return shown


def make_view(kind, fn, args, value):
    """The data the page draws for one function result."""
    if kind == "chunks":
        return {"kind": "chunks", "title": f"{fn}()", "path": args.get("path"),
                "lines": str(args.get("text", "")).splitlines(),
                "chunks": [{"start": c["start"], "end": c["end"]} for c in value]}
    if kind == "vectors":
        texts = args.get("texts") or []
        return {"kind": "vectors", "title": f"embed(): {len(value)} texts → {len(value)} vectors",
                "items": [{"text": short(t, 140), "head": [round(x, 3) for x in v[:40]], "dims": len(v)}
                          for t, v in list(zip(texts, value))[:8]]}
    if kind == "scores":
        items = []
        for item in value:
            label = chunk_label({k: item[k] for k in ("path", "start", "end")}) if "path" in item else item["text"]
            preview = "\n".join(item["text"].splitlines()[:4]) if "path" in item else ""
            items.append({"label": label, "score": item["score"], "preview": preview})
        return {"kind": "scores", "title": f"{fn}(): closest first", "items": items}
    if kind == "index":
        return {"kind": "index", "title": f"build_index({Path(str(args.get('repo', ''))).name})", **value}
    if kind == "text":
        first = next(iter(args.values()), "")
        return {"kind": "text", "title": f"{fn}({first!r})", "text": short(value, 3000)}
    return None


# ---------------------------------------------------------------- one run

class Run:
    def __init__(self, name, task, mode, step, speed, record=None):
        self.name = name
        self.task = task
        self.graph = catalog.STEPS[name]
        self.views = self.graph.get("views", {})
        self.nodes = {node["id"]: node for node in self.graph["nodes"]}
        self.edges = {(a, b): by for a, b, by, _ in self.graph["edges"]}
        self.replay = replay.Replay() if mode == "replay" else None
        self.record = record          # a dict to fill with live answers (record.py)
        self.step = step
        self.set_speed(speed)
        self.events = queue.Queue()
        self.gate = threading.Event()
        self.stopped = False
        self.lock = threading.RLock()
        self.local = threading.local()
        self.scope_ids = count(1)
        self.scopes = {"root": {"frontier": {"input"}, "wave": []}}
        self.threads = {}
        self.line_runs = {}
        self.started = time.time()

    # ---- plumbing ------------------------------------------------------------

    def set_speed(self, speed):
        self.speed = speed if speed in SPEEDS else "normal"
        self.line_delay, self.llm_delay, self.embed_delay = SPEEDS[self.speed]

    def emit(self, event):
        event["t"] = round(time.time() - self.started, 3)
        self.events.put(event)

    def thread(self):
        ident = threading.get_ident()
        with self.lock:
            return self.threads.setdefault(ident, len(self.threads))

    def stack(self):
        if not hasattr(self.local, "stack"):
            self.local.stack = []
        return self.local.stack

    def check(self):
        if self.stopped:
            raise StopRun()

    def wait(self, seconds):
        waited = 0.0
        while waited < seconds:
            time.sleep(0.05)
            waited += 0.05
            self.check()

    # ---- graph bookkeeping ---------------------------------------------------

    def match(self, fn, args, caller):
        for node in self.graph["nodes"]:
            rule = node.get("match")
            if not rule or rule["fn"] != fn:
                continue
            if "in" in rule and rule["in"] != caller:
                continue
            if all(str(args.get(key)) == str(value) for key, value in rule.items() if key not in ("fn", "in")):
                return node["id"]
        return None

    def parent(self, stack):
        for entry in reversed(stack):
            if entry["node"]:
                return entry
        return None

    def light(self, source, target):
        if (source, target) in self.edges:
            self.emit({"type": "edge", "from": source, "to": target, "by": self.edges[(source, target)]})

    def is_call(self, node):
        return self.nodes[node]["kind"] in ("llm", "embed")

    def enter(self, fn, args, shown):
        self.check()
        stack = self.stack()
        caller = stack[-1]["fn"] if stack else None
        node = self.match(fn, args, caller)
        entry = {"fn": fn, "node": node, "scope": None, "args": args}
        if node:
            with self.lock:
                # Which edge brought us here? A sibling that just finished, else
                # the same sources as the sibling that started alongside us,
                # else the parent node that called us.
                parent = self.parent(stack)
                scope = self.scopes[parent["scope"] if parent else "root"]
                sources = [s for s in scope["frontier"] if (s, node) in self.edges]
                if sources:
                    scope["frontier"] -= set(sources)
                    scope["wave"] = sources
                else:
                    sources = [s for s in scope["wave"] if (s, node) in self.edges]
                if not sources and parent and (parent["node"], node) in self.edges:
                    sources = [parent["node"]]
                for source in sources:
                    self.light(source, node)
                entry["scope"] = next(self.scope_ids)
                self.scopes[entry["scope"]] = {"frontier": set(), "wave": []}
            self.emit({"type": "enter", "node": node, "fn": fn, "args": shown, "thread": self.thread()})
        stack.append(entry)
        if node and self.step:
            self.emit({"type": "paused", "node": node})
            self.gate.clear()
            while not self.gate.wait(0.2):
                self.check()
            self.emit({"type": "resumed", "node": node})

    def exit(self, value, failed=False):
        stack = self.stack()
        if not stack:
            return
        entry = stack.pop()
        node = entry["node"]
        if not failed and entry["fn"] in self.views:
            view = make_view(self.views[entry["fn"]], entry["fn"], entry["args"], value)
            if view:
                self.emit({"type": "view", **view})
        if node:
            with self.lock:
                own = self.scopes.pop(entry["scope"], {"frontier": set()})
                for child in own["frontier"]:  # an API call handing its result back up
                    if self.is_call(child):
                        self.light(child, node)
                parent = self.parent(stack)
                scope = self.scopes[parent["scope"] if parent else "root"]
                scope["frontier"].add(node)
                if parent and not self.is_call(node):
                    self.light(node, parent["node"])
            if isinstance(value, llm.Reply):
                value = value.text or "→ " + ", ".join(call.name for call in value.tool_calls)
            self.emit({"type": "exit", "node": node, "value": short(value, 600),
                       "failed": failed, "thread": self.thread()})
        if not stack:
            self.emit({"type": "idle", "thread": self.thread()})

    def current_node(self):
        entry = self.parent(self.stack())
        return entry["node"] if entry else None

    # ---- sys.settrace hooks --------------------------------------------------

    def tracer(self, frame, event, arg):
        if event != "call":
            return None
        code = frame.f_code
        if not code.co_filename.startswith(str(CODE)) or code.co_filename.endswith("llm.py"):
            return None
        if code.co_name == "<module>" or code.co_name in QUIET:
            return None
        if frame.f_back and frame.f_back.f_code.co_name in QUIET:
            return None
        if code.co_name.startswith("<"):  # generator expressions and lambdas: lines only
            return self.lines_only
        names = code.co_varnames[:code.co_argcount + code.co_kwonlyargcount]
        args, shown = {}, {}
        for name in names:
            value = frame.f_locals.get(name)
            if name == "self":
                continue
            args[name] = value
            shown[name] = short(value, 300)
        self.enter(code.co_qualname, args, shown)
        return self.local_tracer

    def local_tracer(self, frame, event, arg):
        if event == "line":
            self.on_line(frame)
        elif event == "return":
            self.emit({"type": "ret", "file": Path(frame.f_code.co_filename).name, "thread": self.thread()})
            self.exit(arg)
        return self.local_tracer

    def lines_only(self, frame, event, arg):
        if event == "line":
            self.on_line(frame)
        return self.lines_only

    def on_line(self, frame):
        file, line = Path(frame.f_code.co_filename).name, frame.f_lineno
        thread = self.thread()
        if getattr(self.local, "last_line", None) == (file, line):
            return  # a loop spinning on one line: show it once
        self.local.last_line = (file, line)
        self.emit({"type": "line", "file": file, "line": line, "thread": thread})
        runs = self.line_runs[(file, line)] = self.line_runs.get((file, line), 0) + 1
        if self.line_delay and runs <= SLOW_REPEATS:  # loops: slow the first rounds, then fast-forward
            time.sleep(self.line_delay)
        self.check()

    # ---- the run itself ------------------------------------------------------

    def load_step(self):
        # The index remembers which embedding model built it, so Replay and Live
        # never mix their vectors. Reloading also picks up live edits to the code.
        llm.EMBED_MODEL = self.replay.model if self.replay else LIVE_EMBED_MODEL
        for name in RELOAD:
            importlib.reload(importlib.import_module(name))
        return importlib.reload(importlib.import_module(self.name))

    def execute(self):
        self.emit({"type": "start", "workflow": self.name, "mode": "replay" if self.replay else "live",
                   "embed_model": self.replay.model if self.replay else LIVE_EMBED_MODEL})
        self.emit({"type": "enter", "node": "input", "fn": "input", "args": {"task": short(self.task, 300)}, "thread": 0})
        self.emit({"type": "exit", "node": "input", "value": short(self.task, 600), "thread": 0})
        try:
            module = self.load_step()
            threading.settrace(self.tracer)
            sys.settrace(self.tracer)
            try:
                result = module.run(self.task)
            finally:
                sys.settrace(None)
                threading.settrace(None)
            for source in self.scopes["root"]["frontier"]:
                self.light(source, "output")
            self.emit({"type": "enter", "node": "output", "fn": "output", "args": {}, "thread": 0})
            self.emit({"type": "exit", "node": "output", "value": short(result, 600), "thread": 0})
            self.emit({"type": "done", "result": short(result)})
        except StopRun:
            self.emit({"type": "stopped"})
        except Exception as error:
            frames = [f for f in traceback.extract_tb(error.__traceback__) if f.filename.startswith(str(CODE))]
            where = frames[-1] if frames else None
            self.emit({"type": "error", "message": f"{type(error).__name__}: {error}",
                       "file": Path(where.filename).name if where else None,
                       "line": where.lineno if where else None,
                       "trace": traceback.format_exc()})
        self.emit({"type": "end"})


CURRENT = None
CURRENT_LOCK = threading.Lock()


# ---------------------------------------------------------------- API calls

def instrument(kind):
    """Wrap llm.embed / ask / chat so each call shows up in the page,
    and is answered without the network in replay mode."""
    real = getattr(llm, kind)

    def wrapper(*args, **kwargs):
        run = CURRENT
        if run is None:
            return real(*args, **kwargs)
        if kind == "embed":
            texts = list(args[0] if args else kwargs["texts"])
            request = {"texts": [short(t, 300) for t in texts[:6]], "count": len(texts)}
            call_args = {"texts": texts}
        elif kind == "chat":
            messages = args[0] if args else kwargs["messages"]
            tools = list(args[1] if len(args) > 1 else kwargs.get("tools", ()))
            request = {"messages": show_messages(messages), "tools": [t.__name__ for t in tools]}
            call_args = {}
        else:
            prompt = args[0] if args else kwargs["prompt"]
            system = args[1] if len(args) > 1 else kwargs.get("system", real.__defaults__[0])
            request = {"system": system, "prompt": short(prompt)}
            call_args = {}

        run.enter(kind, call_args, {})
        result, failed = None, False
        try:
            node = run.current_node()
            run.emit({"type": "llm_start", "kind": kind, "node": node, "request": request, "thread": run.thread()})
            began = time.time()
            if run.replay:
                run.wait(run.embed_delay if kind == "embed" else run.llm_delay)
                if kind == "embed":
                    result = run.replay.embed(texts)
                elif kind == "chat":
                    result = run.replay.chat(messages)
                else:
                    result = run.replay.ask(system, prompt)
            else:
                result = real(*args, **kwargs)
                if run.record is not None:
                    remember(run.record, kind, args, kwargs, result, real)
            run.check()
            if kind == "embed":
                reply = {"text": f"{len(result)} vectors × {len(result[0]) if result else 0} numbers", "tool_calls": []}
            else:
                reply = show_reply(result)
            run.emit({"type": "llm_end", "kind": kind, "node": node, "reply": reply,
                      "seconds": round(time.time() - began, 2), "thread": run.thread()})
            return result
        except BaseException:
            failed = True
            raise
        finally:
            run.exit(result, failed)

    wrapper.__name__ = kind
    return wrapper


def remember(record, kind, args, kwargs, result, real):
    """record.py: keep live answers so replay can give them back later."""
    if kind == "embed":
        texts = args[0] if args else kwargs["texts"]
        for text, vector in zip(texts, result):
            record["embeddings"][replay.text_key(text)] = [round(x, 5) for x in vector]
    elif kind == "ask":
        prompt = args[0] if args else kwargs["prompt"]
        system = args[1] if len(args) > 1 else kwargs.get("system", real.__defaults__[0])
        record["replies"][replay.text_key(system + prompt)] = result
    else:
        messages = args[0] if args else kwargs["messages"]
        key = replay.text_key(json.dumps(messages, sort_keys=True, default=str))
        record["replies"][key] = {"text": result.text,
                                  "calls": [{"id": c.id, "name": c.name, "args": c.args} for c in result.tool_calls]}


for _kind in ("embed", "ask", "chat"):
    setattr(llm, _kind, instrument(_kind))


# ---------------------------------------------------------------- the page's API

def step_files(name):
    """The step file, every rag/ file it imports (directly or not), then llm.py."""
    order, todo = [], [name]
    while todo:
        module = todo.pop(0)
        if module in order or not (CODE / f"{module}.py").exists():
            continue
        order.append(module)
        source = (CODE / f"{module}.py").read_text()
        todo += re.findall(r"^from (\w+) import", source, re.MULTILINE)
    order = [m for m in order if m != "llm"] + ["llm"]
    return {f"{m}.py": (CODE / f"{m}.py").read_text() for m in order}


def describe():
    steps = []
    for module, names in catalog.MODULES:
        for name in names:
            meta = dict(catalog.STEPS[name])
            meta["edges"] = [{"from": a, "to": b, "by": by, "label": label} for a, b, by, label in meta["edges"]]
            meta.pop("views", None)
            steps.append({"name": name, "module": module, **meta, "files": step_files(name)})
    return {"workflows": steps, "has_key": HAS_KEY, "model": llm.MODEL, "embed_model": LIVE_EMBED_MODEL,
            "replay_model": replay.Replay().model,
            "base_url": os.environ.get("OPENAI_BASE_URL", "api.openai.com")}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, status, body, content_type="application/json"):
        data = body if isinstance(body, bytes) else body.encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        query = {key: values[-1] for key, values in parse_qs(url.query).items()}
        if url.path == "/api/workflows":
            return self.send(200, json.dumps(describe(), ensure_ascii=False))
        if url.path == "/api/run":
            return self.stream(query)
        if url.path == "/api/control":
            return self.control(query)
        if url.path == "/slides":
            self.send_response(301)
            self.send_header("Location", "/slides/")
            self.end_headers()
            return
        if url.path.startswith("/slides/"):
            return self.slides(url.path[len("/slides/"):] or "index.html")
        files = {"/": "index.html", "/app.js": "app.js", "/style.css": "style.css"}
        if url.path in files:
            path = UI / files[url.path]
            kind = {"html": "text/html", "js": "text/javascript", "css": "text/css"}[path.suffix[1:]]
            return self.send(200, path.read_bytes(), f"{kind}; charset=utf-8")
        self.send(404, "not found", "text/plain")

    def slides(self, name):
        folder = (ROOT / "slides").resolve()
        path = (folder / name).resolve()
        if folder not in path.parents or not path.is_file():
            return self.send(404, "not found", "text/plain")
        kinds = {".html": "text/html; charset=utf-8", ".png": "image/png", ".woff2": "font/woff2"}
        self.send(200, path.read_bytes(), kinds.get(path.suffix, "application/octet-stream"))

    def control(self, query):
        run = CURRENT
        action = query.get("action")
        if run:
            if action == "next":
                run.gate.set()
            elif action == "stop":
                run.stopped = True
            elif action == "step":
                run.step = query.get("value") == "1"
                if not run.step:
                    run.gate.set()
            elif action == "speed":
                run.set_speed(query.get("value"))
        self.send(200, json.dumps({"ok": True, "running": run is not None}))

    def stream(self, query):
        global CURRENT
        name = query.get("workflow")
        if name not in catalog.STEPS:
            return self.send(400, "unknown step", "text/plain")
        run = Run(name, query.get("task") or catalog.STEPS[name]["example"],
                  query.get("mode", "replay"), query.get("step") == "1", query.get("speed", "normal"))
        with CURRENT_LOCK:
            if CURRENT:
                CURRENT.stopped = True
                time.sleep(0.3)
            CURRENT = run

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

        def work():
            global CURRENT
            try:
                run.execute()
            finally:
                if CURRENT is run:
                    CURRENT = None

        threading.Thread(target=work, daemon=True).start()
        try:
            while True:
                try:
                    event = run.events.get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b": keep-alive\n\n")
                    self.wfile.flush()
                    continue
                self.wfile.write(f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode())
                self.wfile.flush()
                if event["type"] == "end":
                    break
        except (BrokenPipeError, ConnectionResetError):
            run.stopped = True


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.daemon_threads = True
    print(f"Week 7 · RAG from scratch → http://127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
