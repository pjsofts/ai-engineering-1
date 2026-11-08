// Week 9 · Planning & Memory: draws each step and animates it from the server's events.
// The same page as week 1, with a Data panel for this week: the conversation the
// model sees, the agent's todo list, test runs, changed files, the feature list
// and the checker's verdict. input() becomes a Yes / No dialog (plan approval).
const $ = (id) => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";
const UX = 172, UY = 108;                       // grid unit in px
const SIZE = { llm: [164, 64], agent: [164, 64], code: [164, 64], human: [164, 64], tool: [178, 50], io: [104, 48] };
const TAG = { llm: "LLM", agent: "AGENT LOOP", tool: "TOOL", code: "CODE", human: "HUMAN", io: "" };

const saved = JSON.parse(localStorage.getItem("w9-settings") || "{}");
const state = {
  data: null, list: [], index: 0, wf: null,
  mode: saved.mode || "replay", speed: saved.speed || "normal", step: !!saved.step,
  theme: saved.theme || "dark", layout: saved.layout || "split",
  sidebar: saved.sidebar !== false, trace: saved.trace !== false, panel: saved.panel || "data",
  es: null, running: false, file: null,
  nodes: {}, edges: {}, geo: {},
  lines: {}, lastLine: {}, seen: {}, waiting: {},
  stats: null, inputs: {},
};

function save() {
  const { mode, speed, step, theme, layout, sidebar, trace, panel } = state;
  localStorage.setItem("w9-settings", JSON.stringify({ mode, speed, step, theme, layout, sidebar, trace, panel, last: state.wf?.name }));
}

function el(tag, attrs = {}, ...children) {
  const node = tag.startsWith("svg:") ? document.createElementNS(SVG, tag.slice(4)) : document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.setAttribute("class", value);
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

const clip = (text, n) => { text = String(text ?? "").replace(/\s+/g, " ").trim(); return text.length > n ? text.slice(0, n - 1) + "…" : text; };

// ---------------------------------------------------------------- boot
// The static build (GitHub Pages) has no server: it sets window.STATIC and
// plays back runs recorded by export_static.py instead of running Python.
const STATIC = !!window.STATIC;

async function boot() {
  state.data = await (await fetch(STATIC ? "data.json" : "/api/workflows")).json();
  if (STATIC) {
    state.mode = "replay";
    $("mode").classList.add("hidden");
    $("task").readOnly = true;
    $("task").title = "A recorded run: the input is fixed. Run the project locally to try your own.";
    $("reset-task").classList.add("hidden");
  }
  state.list = state.data.workflows;
  $("help-model").textContent = `Live: ${state.data.model} via ${state.data.base_url}` +
    (state.data.has_key ? "" : " (no OPENAI_API_KEY found, so only Replay works)");
  renderSidebar();
  applySettings();
  const last = state.list.findIndex((w) => w.name === (location.hash.slice(1) || saved.last));
  select(last >= 0 ? last : 0);
  wireControls();
}

function renderSidebar() {
  const nav = $("sidebar");
  nav.innerHTML = "";
  let module = null, n = 0;
  state.list.forEach((wf, i) => {
    if (wf.module !== module) { module = wf.module; nav.append(el("h3", { text: module })); }
    n += 1;
    nav.append(el("a", { "data-i": i, onclick: () => select(i) }, el("span", { class: "n", text: n }), el("span", { text: wf.title })));
  });
}

function applySettings() {
  document.documentElement.dataset.theme = state.theme;
  for (const id of ["mode", "speed"]) {
    for (const b of $(id).querySelectorAll("button")) b.classList.toggle("on", b.dataset.value === state[id]);
  }
  $("step").classList.toggle("on", state.step);
  $("app").classList.toggle("no-sidebar", !state.sidebar);
  $("app").classList.toggle("no-trace", !state.trace);
  for (const b of document.querySelectorAll(".panel-tabs button")) b.classList.toggle("on", b.dataset.panel === state.panel);
  $("data").classList.toggle("hidden", state.panel !== "data");
  $("trace").classList.toggle("hidden", state.panel !== "trace");
  $("stage").className = "stage" + (state.layout === "split" ? "" : " " + state.layout);
  save();
}

function select(i) {
  if (state.running) stop();
  state.index = (i + state.list.length) % state.list.length;
  state.wf = state.list[state.index];
  history.replaceState(null, "", "#" + state.wf.name);
  for (const a of $("sidebar").querySelectorAll("a")) a.classList.toggle("on", +a.dataset.i === state.index);
  $("wf-module").textContent = state.wf.module;
  $("wf-title").textContent = state.wf.title;
  $("wf-summary").textContent = state.wf.summary;
  const decides = state.wf.decides;
  $("wf-decides").textContent = decides.charAt(0).toUpperCase() + decides.slice(1);
  $("wf-decides-box").className = "decides " + (decides.startsWith("model") ? "model" : "code");
  $("wf-hint").textContent = state.wf.hint || "";
  const task = $("task");
  task.value = state.inputs[state.wf.name] ?? state.wf.example;
  task.rows = 1;
  state.file = Object.keys(state.wf.files)[0];
  reset();
  renderDiagram();
  renderTabs();
  renderCode();
  setStatus("Press <b>Enter</b> to run" + (state.step ? " · step mode: <b>Space</b> advances" : ""));
  save();
}

// ---------------------------------------------------------------- diagram
function renderDiagram() {
  const svg = $("diagram");
  svg.innerHTML = "";
  svg.classList.remove("finished");
  const nodes = state.wf.nodes;
  const geo = {};
  for (const n of nodes) {
    const [w, h] = SIZE[n.kind];
    geo[n.id] = { x: n.x * UX, y: n.y * UY, w, h, kind: n.kind };
  }
  state.geo = geo;
  const xs = Object.values(geo).flatMap((g) => [g.x - g.w / 2, g.x + g.w / 2]);
  const ys = Object.values(geo).flatMap((g) => [g.y - g.h / 2 - 50, g.y + g.h / 2 + 24]);
  const pad = 30;
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
  svg.setAttribute("viewBox", `${minX} ${minY} ${Math.max(...xs) - minX + pad} ${Math.max(...ys) - minY + pad + 30}`);

  const defs = el("svg:defs");
  for (const [name, color] of [["code", "var(--edge)"], ["model", "var(--model)"], ["lit", "var(--lit)"], ["used", "var(--text)"]]) {
    defs.append(el("svg:marker", { id: "arrow-" + name, viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" },
      el("svg:path", { d: "M0,0 L10,5 L0,10 z", style: `fill:${color}` })));
  }
  svg.append(defs);

  const edgeLayer = el("svg:g"), nodeLayer = el("svg:g"), fxLayer = el("svg:g", { id: "fx" });
  svg.append(edgeLayer, nodeLayer, fxLayer);
  const pairs = new Set(state.wf.edges.map((e) => `${e.from}>${e.to}`));
  for (const e of state.wf.edges) {
    const key = `${e.from}>${e.to}`;
    const two = e.from !== e.to && pairs.has(`${e.to}>${e.from}`);
    const shape = edgeShape(geo[e.from], geo[e.to], two);
    const path = el("svg:path", { class: "wire", d: shape.d, "marker-end": `url(#arrow-${e.by})` });
    const g = el("svg:g", { class: `edge ${e.by}` }, path);
    if (e.label) g.append(el("svg:text", { x: shape.lx, y: shape.ly + 4, "text-anchor": "middle", text: e.label }));
    const count = el("svg:text", { class: "count", x: shape.lx, y: shape.ly + (e.label ? 20 : 4), "text-anchor": "middle" });
    g.append(count);
    edgeLayer.append(g);
    state.edges[key] = { g, path, count, n: 0, by: e.by, timer: null };
  }
  for (const n of nodes) {
    const g = geo[n.id];
    const box = el("svg:rect", { class: "box", x: g.x - g.w / 2, y: g.y - g.h / 2, width: g.w, height: g.h, rx: n.kind === "io" ? g.h / 2 : 14 });
    const hasSub = n.kind !== "io";
    const label = el("svg:text", { class: "label", x: g.x, y: g.y + (hasSub ? -2 : 6), text: n.label });
    const sub = el("svg:text", { class: "sub", x: g.x, y: g.y + 19 });
    const tag = el("svg:text", { class: "tag", x: g.x - g.w / 2 + 4, y: g.y - g.h / 2 - 7, text: TAG[n.kind] });
    const badge = el("svg:g", { class: "badge hidden" },
      el("svg:circle", { cx: g.x + g.w / 2 - 4, cy: g.y - g.h / 2 + 2, r: 13 }),
      el("svg:text", { x: g.x + g.w / 2 - 4, y: g.y - g.h / 2 + 6 }));
    const group = el("svg:g", { class: `node kind-${n.kind}`, "data-id": n.id }, box, label, sub, tag, badge);
    group.addEventListener("click", (ev) => showPopover(n.id, ev));
    nodeLayer.append(group);
    const fit = g.w - 18, width = label.getComputedTextLength();
    if (width > fit) label.style.fontSize = `${parseFloat(getComputedStyle(label).fontSize) * fit / width}px`;
    state.nodes[n.id] = { g: group, sub, badge, label: n.label, kind: n.kind, count: 0, active: 0, last: null };
  }
}

function boxPoint(g, tx, ty) {
  // where the ray from the centre of box g towards (tx, ty) leaves the box
  const dx = tx - g.x, dy = ty - g.y;
  const sx = (g.w / 2 + 3) / Math.abs(dx || 1e-9), sy = (g.h / 2 + 3) / Math.abs(dy || 1e-9);
  const s = Math.min(sx, sy);
  return [g.x + dx * s, g.y + dy * s];
}

function bezier(p0, c, p1, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]];
}

function hitsOther(a, b, c) {
  const others = Object.values(state.geo).filter((g) => g !== a && g !== b);
  for (let t = 0.08; t < 0.95; t += 0.04) {
    const [x, y] = bezier([a.x, a.y], c, [b.x, b.y], t);
    if (others.some((g) => Math.abs(x - g.x) < g.w / 2 + 10 && Math.abs(y - g.y) < g.h / 2 + 10)) return true;
  }
  return false;
}

function edgeShape(a, b, twoWay) {
  if (a === b) { // self loop above the node
    const top = a.y - a.h / 2, l = a.x - 40, r = a.x + 40;
    return { d: `M${l},${top - 2} C${l - 20},${top - 70} ${r + 20},${top - 70} ${r},${top - 4}`, lx: a.x, ly: top - 62 };
  }
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  const offsets = twoWay ? [34, 70, 110] : [0, 60, -60, 110, -110, 160, -160];
  let c = [mx, my];
  for (const off of offsets) {
    c = [mx + nx * off, my + ny * off];
    if (!hitsOther(a, b, c)) break;
  }
  const p0 = boxPoint(a, ...c), p1 = boxPoint(b, ...c);
  let [lx, ly] = bezier(p0, c, p1, 0.5);
  if (twoWay) { lx += nx * 34; ly += ny * 22; } // keep the two labels of a pair apart
  return { d: `M${p0[0]},${p0[1]} Q${c[0]},${c[1]} ${p1[0]},${p1[1]}`, lx, ly };
}

function lightEdge(from, to) {
  const e = state.edges[`${from}>${to}`];
  if (!e) return;
  e.n += 1;
  e.g.classList.add("used", "lit");
  e.path.setAttribute("marker-end", "url(#arrow-lit)");
  e.count.textContent = e.n > 1 ? `×${e.n}` : "";
  clearTimeout(e.timer);
  e.timer = setTimeout(() => {
    e.g.classList.remove("lit");
    e.path.setAttribute("marker-end", `url(#arrow-${e.by === "model" ? "model" : "used"})`);
  }, 1100);
  // a dot that travels along the wire
  const dot = el("svg:circle", { class: "pulse", r: 7 });
  $("fx").append(dot);
  const total = e.path.getTotalLength(), start = performance.now(), dur = 650;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const p = e.path.getPointAtLength(total * (1 - Math.pow(1 - t, 2)));
    dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y);
    if (t < 1) requestAnimationFrame(tick); else dot.remove();
  };
  requestAnimationFrame(tick);
}

function nodeState(id, patch) {
  const n = state.nodes[id];
  if (!n) return;
  Object.assign(n, patch);
  const cls = n.g.classList;
  cls.toggle("active", n.active > 0);
  cls.toggle("done", n.count > 0 && n.active === 0 && !n.failed);
  cls.toggle("failed", !!n.failed);
  cls.toggle("thinking", (n.thinking || 0) > 0);
  cls.toggle("paused", !!n.paused);
  n.badge.classList.toggle("hidden", n.count < 2);
  n.badge.querySelector("text").textContent = `×${n.count}`;
}

function setSub(id, text) {
  const n = state.nodes[id];
  if (n && n.kind !== "io") n.sub.textContent = clip(text, 26);
}

function showPopover(id, ev) {
  const n = state.nodes[id], pop = $("popover");
  if (!n) return;
  pop.innerHTML = "";
  pop.append(el("h4", { text: n.label }));
  if (!n.last) pop.append(el("div", { class: "muted", text: "Not run yet." }));
  else {
    if (n.last.args && Object.keys(n.last.args).length) {
      pop.append(el("div", { class: "muted", text: "called with" }), el("pre", { dir: "auto", text: Object.entries(n.last.args).map(([k, v]) => `${k} = ${v}`).join("\n") }));
    }
    if (n.last.value !== undefined) pop.append(el("div", { class: "muted", text: "returned" }), el("pre", { dir: "auto", text: n.last.value }));
    pop.append(el("div", { class: "muted", text: `ran ${n.count}×` }));
  }
  const wrap = $("diagram").parentElement.getBoundingClientRect();
  pop.style.left = Math.min(ev.clientX - wrap.left + 12, wrap.width - 470) + "px";
  pop.style.top = Math.max(8, ev.clientY - wrap.top - 20) + "px";
  pop.classList.remove("hidden");
  ev.stopPropagation();
}
document.addEventListener("click", (ev) => { if (!$("popover").contains(ev.target)) $("popover").classList.add("hidden"); });

// ---------------------------------------------------------------- code view
const KEYWORDS = new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "));
const BUILTINS = new Set("print len range list dict set str int float bool isinstance enumerate zip open min max sum sorted any all repr type super eval exec next iter map filter getattr hasattr setattr".split(" "));
const TOKEN = /([rRbBfFuU]{0,2})("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(#[^\n]*)|\b(\d[\d_]*(?:\.\d+)?)\b|([A-Za-z_]\w*)/g;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function highlight(source) {
  // returns one HTML string per line
  const parts = []; // [class, text]
  let last = 0, prev = "", m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(source))) {
    if (m.index > last) parts.push([null, source.slice(last, m.index)]);
    if (m[2] !== undefined) parts.push([/f/i.test(m[1]) ? "fstr" : "str", m[1] + m[2]]);
    else if (m[3] !== undefined) parts.push(["com", m[3]]);
    else if (m[4] !== undefined) parts.push(["num", m[4]]);
    else {
      const w = m[5], after = source[m.index + w.length];
      let cls = null;
      if (KEYWORDS.has(w)) cls = ["True", "False", "None"].includes(w) ? "const" : "kw";
      else if (prev === "def" || prev === "class") cls = "def";
      else if (w === "self") cls = "self";
      else if (BUILTINS.has(w) && after === "(") cls = "bi";
      else if (after === "(") cls = "call";
      else if (/^[A-Z][A-Z0-9_]+$/.test(w)) cls = "const";
      parts.push([cls, w]);
      prev = w;
    }
    if (m[5] === undefined) prev = "";
    last = TOKEN.lastIndex;
  }
  if (last < source.length) parts.push([null, source.slice(last)]);

  const lines = [""];
  for (const [cls, text] of parts) {
    text.split("\n").forEach((piece, i) => {
      if (i > 0) lines.push("");
      if (!piece) return;
      let html = esc(piece);
      if (cls === "fstr") html = `<span class="tok-str">${html.replace(/\{[^{}]*\}/g, (x) => x.startsWith("{{") ? x : `<span class="tok-fx">${x}</span>`)}</span>`;
      else if (cls) html = `<span class="tok-${cls}">${html}</span>`;
      lines[lines.length - 1] += html;
    });
  }
  return lines;
}

function renderTabs() {
  const tabs = $("tabs");
  tabs.innerHTML = "";
  for (const name of Object.keys(state.wf.files)) {
    tabs.append(el("button", { class: name === state.file ? "on" : "", "data-file": name, text: name, onclick: () => { state.file = name; renderTabs(); renderCode(); } }));
  }
  markBusyTabs();
}

function renderCode() {
  const box = $("code");
  box.innerHTML = "";
  const lines = highlight(state.wf.files[state.file]);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  lines.forEach((html, i) => {
    const row = el("div", { class: "ln", "data-line": i + 1 }, el("span", { class: "num", text: i + 1 }));
    const src = el("span", { class: "src" });
    src.innerHTML = html || " ";
    row.append(src);
    box.append(row);
  });
  box.scrollTop = 0;
  paintLines(false);
}

function paintLines(scroll = true) {
  const box = $("code"), file = state.file;
  const active = state.lines[file] || {};
  const seen = state.seen[file] || new Set();
  const waiting = new Set(Object.entries(state.waiting).filter(([, v]) => v && v.file === file).map(([, v]) => v.line));
  let target = null;
  for (const row of box.children) {
    const n = +row.dataset.line;
    const threads = Object.entries(active).filter(([, line]) => line === n).map(([t]) => +t);
    row.className = "ln" + (seen.has(n) ? " seen" : "") + (threads.length ? ` active t${threads[0] % 4}` : "") +
      (waiting.has(n) ? " waiting" : "") + (state.errorAt && state.errorAt.file === file && state.errorAt.line === n ? " err" : "");
    if (threads.length && (target === null || threads[0] === 0)) target = row;
  }
  if (scroll && target) {
    const top = target.offsetTop, view = box.scrollTop, h = box.clientHeight;
    if (top < view + 40 || top > view + h * 0.6) box.scrollTo({ top: top - h * 0.3, behavior: "smooth" });
  }
  markBusyTabs();
}

function markBusyTabs() {
  for (const b of $("tabs").querySelectorAll("button")) {
    const lines = state.lines[b.dataset.file] || {};
    b.classList.toggle("busy", b.dataset.file !== state.file && Object.values(lines).some((v) => v != null));
  }
}

let paintQueued = false;
function queuePaint() {
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => { paintQueued = false; paintLines(); });
}

// ---------------------------------------------------------------- trace panel
function trace(node, cls = "") {
  const box = $("trace");
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  node.classList.add("ev");
  if (cls) cls.split(" ").forEach((c) => c && node.classList.add(c));
  box.append(node);
  if (stick) box.scrollTop = box.scrollHeight;
  return node;
}
const stamp = (t) => el("span", { class: "t", text: `${t.toFixed(1)}s` });
const kindOf = (id) => state.nodes[id]?.kind || "code";
const labelOf = (id) => state.nodes[id]?.label || id || "";

function traceLLM(ev) {
  const r = ev.request;
  const body = el("div");
  if (r.messages) {
    const lastAssistant = r.messages.map((m) => m.role).lastIndexOf("assistant");
    const fresh = r.messages.slice(lastAssistant + 1);
    const all = el("details", {}, el("summary", { text: `full conversation: ${r.messages.length} messages` + (r.tools.length ? ` · tools: ${r.tools.join(", ")}` : "") }),
      ...r.messages.map((m) => msgBox(m)));
    body.append(...fresh.filter((m) => m.role !== "system" || r.messages.length === 1).map((m) => msgBox(m)), all);
  } else {
    body.append(el("details", {}, el("summary", { text: "system prompt" }), msgBox({ role: "system", content: r.system })), msgBox({ role: "user", content: r.prompt }));
  }
  const reply = el("div", { class: "reply muted", text: "…thinking" });
  const who = `LLM · ${labelOf(ev.node) || ev.kind}`;
  const entry = trace(el("div", {}, stamp(ev.t), el("span", { class: "who", text: who }), body, reply), "llm-call k-llm");
  return { entry, reply };
}

function msgBox(m) {
  const box = el("div", { class: "msg", dir: "auto" }, el("span", { class: "role", text: m.role }));
  box.append(document.createTextNode(clip(m.content, 1200) || ""));
  if (m.tool_calls) box.append(el("div", { class: "calls", text: m.tool_calls.join("\n") }));
  return box;
}

// ---------------------------------------------------------------- data panel
// The conversation: every chat() call sends the whole list of messages again,
// so the card is redrawn from the request each time. The reply is added below it.
// The server also sends a "view" for eval rows, token counts and summaries.
function addCard(title, body, cls = "") {
  const box = $("data");
  box.querySelector(".data-empty")?.remove();
  const card = el("div", { class: "card " + cls }, el("div", { class: "card-head", text: title }), body);
  box.append(card);
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return card;
}

function bubble(m, fresh) {
  const box = el("div", { class: `bubble role-${m.role}` + (fresh ? " fresh" : ""), dir: "auto" },
    el("span", { class: "role", text: m.role === "tool" ? "tool result" : m.role }));
  if (m.content) box.append(el("div", { class: "content", text: m.content.length > 900 ? m.content.slice(0, 899) + "…" : m.content }));
  if (m.tool_calls) box.append(el("div", { class: "calls", text: m.tool_calls.map((c) => "→ " + c).join("\n") }));
  return box;
}

// Two messages that start a conversation: when they change, a different agent
// (or a fresh session) is talking, so it gets its own card.
const convoKey = (messages) => JSON.stringify(messages.slice(0, 2).map((m) => [m.role, m.content]));

function showConversation(request) {
  let old = state.conversation;
  if (old && old.key !== convoKey(request.messages)) old = null;
  const known = old ? old.count : 0;
  const list = el("div", { class: "convo" }, ...request.messages.map((m, i) => bubble(m, old && i >= known)));
  const sub = el("div", { class: "card-sub", text:
    `${request.messages.length} messages sent` + (request.tools.length ? ` · tools on the table: ${request.tools.join(", ")}` : " · no tools") });
  const body = el("div", {}, sub, list);
  if (old && old.card.isConnected) {
    old.card.replaceChild(body, old.card.lastChild);
    old.card.querySelector(".card-head").textContent = `What the model sees · call ${state.stats.llm}`;
    state.conversation = { card: old.card, list, count: request.messages.length, pending: true, key: old.key };
  } else {
    state.convos = (state.convos || 0) + 1;
    const card = addCard(`What the model sees · call ${state.stats.llm}`, body, "wide convo-card");
    if (state.convos > 1) card.querySelector(".card-head").before(el("div", { class: "fresh-tag", text: "a new conversation" }));
    state.conversation = { card, list, count: request.messages.length, pending: true, key: convoKey(request.messages) };
  }
  list.append(el("div", { class: "bubble role-assistant waiting", text: "…thinking" }));
  list.lastChild.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function addReply(reply) {
  const c = state.conversation;
  c.pending = false;
  c.list.querySelector(".waiting")?.remove();
  const m = { role: "assistant", content: reply.text, tool_calls: reply.tool_calls.length ? reply.tool_calls : null };
  c.list.append(bubble(m, true));
  c.list.lastChild.classList.add("reply");
  c.list.lastChild.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function addView(v) {
  if (v.kind === "todos") showTodos(v);
  else if (v.kind === "tests") addCard(v.passed ? "✔ Tests passed" : "✘ Tests failed", testView(v), "half " + (v.passed ? "pass-card" : "fail-card"));
  else if (v.kind === "files") addCard(`Files changed: ${v.files.length}`, filesView(v), "half " + (v.files.length > 3 ? "fail-card" : ""));
  else if (v.kind === "features") addCard(`${v.title}: features.json`, featureView(v), "wide");
  else if (v.kind === "session") addCard(`resume_session(): ${v.file} · ${v.lines.length} lines`, sessionView(v), "wide");
  else if (v.kind === "memory") addCard(`${v.title}: ~/.mycode/memory.md`, el("pre", { class: "file-view", dir: "auto", text: v.text }), "half");
  else if (v.kind === "progress") addCard("PROGRESS.md: the handoff", el("pre", { class: "file-view", dir: "auto", text: v.text }), "wide progress-card");
  else if (v.kind === "verdict") addCard(v.passed ? "Checker: PASSED" : "Checker: FAILED", el("div", { class: "verdict", dir: "auto", text: v.verdict }), "wide " + (v.passed ? "pass-card" : "fail-card"));
}

// The session file: one line per message, exactly as it is saved on disk.
function sessionView(v) {
  return el("ol", { class: "jsonl" }, ...v.lines.map((l) =>
    el("li", {}, el("span", { class: "role role-" + l.role, text: l.role }), el("span", { dir: "auto", text: l.text }))));
}

// The todo list is plain text, one task per line: "[x] done", "[>] doing", "[ ] later".
const TODO_ICONS = { "[x]": ["✔", "done"], "[>]": ["▶", "doing"], "[ ]": ["○", "later"] };

// One card follows the list as it changes. A rejected list gets its own red card, and stays.
function showTodos(v) {
  const rejected = v.result.startsWith("Error");
  const body = todoView(v);
  if (!rejected && state.todoCard && state.todoCard.isConnected) {
    state.todoCard.replaceChild(body, state.todoCard.lastChild);
    state.todoCard.classList.remove("flash"); void state.todoCard.offsetWidth; state.todoCard.classList.add("flash");
    state.todoCard.querySelector(".card-head").textContent = `The agent's todo list · update ${++state.todoUpdates}`;
    return;
  }
  const card = addCard(rejected ? "write_todos(): rejected" : "The agent's todo list", body, "half todo-card" + (rejected ? " fail-card" : ""));
  if (!rejected) { state.todoCard = card; state.todoUpdates = 1; }
}

function todoView(v) {
  const list = el("ul", { class: "todos" });
  for (const line of v.todos.split("\n")) {
    const mark = line.trim().slice(0, 3), [icon, cls] = TODO_ICONS[mark] || ["?", "bad"];
    list.append(el("li", { class: cls }, el("span", { class: "icon", text: icon }), el("span", { text: line.trim().slice(3).trim() })));
  }
  const rejected = v.result.startsWith("Error");
  return el("div", {}, list, rejected ? el("div", { class: "todo-error", text: "Rejected by the tool: " + v.result.slice(7) }) : null);
}

function testView(v) {
  const lines = v.output.split("\n").slice(1);
  const summary = lines.filter((l) => /^(Ran |OK|FAILED|ERROR|ImportError|AssertionError)/.test(l.trim()) || /Error:/.test(l)).slice(0, 4);
  return el("div", {},
    el("div", { class: "card-sub mono", text: "$ " + v.command }),
    el("pre", { class: "test-summary", text: summary.join("\n") || lines.slice(-3).join("\n") }),
    el("details", {}, el("summary", { text: "full output" }), el("pre", { class: "text-view", text: lines.join("\n") })));
}

function filesView(v) {
  if (!v.files.length) return el("div", { class: "card-sub", text: "Nothing was changed." });
  return el("ul", { class: "files" }, ...v.files.map((f) => el("li", { class: f.endsWith("(new)") ? "new" : "", text: f })));
}

const STATE_ICON = { passing: "✔ passing", failing: "✘ failing", not_started: "○ not started" };

function featureView(v) {
  const rows = v.features.map((f) => el("tr", { class: "state-" + f.state },
    el("td", { class: "mono", text: f.id }),
    el("td", { text: f.behavior }),
    el("td", { class: "mono small", text: f.verify }),
    el("td", { class: "state", text: STATE_ICON[f.state] || f.state })));
  return el("table", { class: "features" },
    el("thead", {}, el("tr", {}, ...["", "behavior", "checked by", "state"].map((h) => el("th", { text: h })))),
    el("tbody", {}, ...rows));
}

// ---------------------------------------------------------------- input() dialog
function showAsk(ev) {
  state.asking = ev.node;
  if (ev.node) nodeState(ev.node, { paused: true });
  $("ask-prompt").textContent = ev.prompt;
  $("ask").classList.remove("hidden");
  setStatus("<b>Waiting for you</b> · Y = yes, N = no", "paused");
}

function answer(value) {
  if ($("ask").classList.contains("hidden")) return;
  $("ask").classList.add("hidden");
  fetch(`/api/control?action=answer&value=${encodeURIComponent(value)}`);
  setStatus(`<b>Running</b> · ${state.mode}`);
}

// ---------------------------------------------------------------- running
function reset() {
  state.nodes = {}; state.edges = {};
  state.lines = {}; state.lastLine = {}; state.seen = {}; state.waiting = {};
  state.errorAt = null; state.pendingLLM = {};
  state.stats = { llm: 0, tools: 0, start: 0 };
  state.conversation = null; state.convos = 0; state.todoCard = null;
  $("ask").classList.add("hidden");
  $("trace").innerHTML = "";
  $("data").innerHTML = "";
  $("data").append(el("div", { class: "data-empty muted", text: "Run the step: the conversation the model sees appears here, with the todo list, test runs and changed files." }));
  $("popover").classList.add("hidden");
}

function setStatus(html, cls = "") {
  $("status").innerHTML = html;
  $("status").className = "status " + cls;
}

function run() {
  if (state.running) stop();
  state.inputs[state.wf.name] = $("task").value;
  reset();
  renderDiagram();
  paintLines(false);
  if (state.mode === "live" && !state.data.has_key) {
    setStatus("No API key: add OPENAI_API_KEY to .env, or use Replay", "error");
    return;
  }
  state.running = true;
  if (STATIC) {
    state.es = new Player(state.data.recordings[state.wf.name], handle);
    state.stats.start = performance.now();
    updateButtons();
    setStatus("<b>Running</b> · recorded replay");
    return;
  }
  const params = new URLSearchParams({ workflow: state.wf.name, task: $("task").value, mode: state.mode, step: state.step ? "1" : "0", speed: state.speed });
  state.es = new EventSource("/api/run?" + params);
  state.stats.start = performance.now();
  updateButtons();
  setStatus(`<b>Running</b> · ${state.mode}`);
  state.es.onmessage = (msg) => handle(JSON.parse(msg.data));
  state.es.onerror = () => { if (state.running) finish("Connection lost", "error"); };
}

function stop() {
  if (!STATIC) fetch("/api/control?action=stop");
  finish("Stopped");
}

function finish(text, cls = "") {
  state.es?.close();
  state.es = null;
  state.running = false;
  state.paused = null;
  for (const id of Object.keys(state.nodes)) nodeState(id, { paused: false, thinking: 0 });
  updateButtons();
  if (text) setStatus(text, cls);
}

function updateButtons() {
  $("run").disabled = false;
  $("run").textContent = state.running ? "↻ Restart" : "▶ Run";
  $("stop").disabled = !state.running;
  $("next").disabled = !state.paused;
}

function control(action, value) {
  if (STATIC) { if (action === "next" || (action === "step" && value === "0")) state.es?.resume?.(); return; }
  if (state.running) fetch(`/api/control?action=${action}` + (value !== undefined ? `&value=${value}` : ""));
}

function next() {
  if (!state.paused) return;
  control("next");
}

// Plays recorded events on a virtual clock, so speed changes and step-mode
// pauses work just like a live run.
const PLAYBACK = { slow: 2, normal: 1, fast: 0.35 };

class Player {
  constructor(events, onEvent) {
    this.events = events;
    this.onEvent = onEvent;
    this.i = 0;
    this.clock = 0;
    this.pausedAt = null;
    this.closed = false;
    this.last = performance.now();
    requestAnimationFrame((now) => this.tick(now));
  }

  tick(now) {
    if (this.closed) return;
    const dt = (now - this.last) / 1000;
    this.last = now;
    if (!this.pausedAt) this.clock += dt / PLAYBACK[state.speed];
    while (!this.pausedAt && this.i < this.events.length && this.events[this.i].t <= this.clock) {
      const ev = this.events[this.i++];
      this.onEvent(ev);
      if (state.step && ev.type === "enter" && state.nodes[ev.node] && ev.node !== "input" && ev.node !== "output") {
        this.pausedAt = ev.node;
        this.onEvent({ type: "paused", node: ev.node });
      }
    }
    if (this.i < this.events.length) requestAnimationFrame((t) => this.tick(t));
  }

  resume() {
    if (!this.pausedAt) return;
    const node = this.pausedAt;
    this.pausedAt = null;
    this.onEvent({ type: "resumed", node });
  }

  close() { this.closed = true; }
}

function summaryLine() {
  const s = state.stats, secs = ((performance.now() - s.start) / 1000).toFixed(1);
  const n = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;
  return `${secs}s · ${n(s.llm, "LLM call")} · ${n(s.tools, "tool call")}`;
}

function handle(ev) {
  switch (ev.type) {
    case "enter": {
      const n = state.nodes[ev.node];
      if (!n) break;
      n.last = { args: ev.args };
      nodeState(ev.node, { count: n.count + 1, active: n.active + 1, failed: false });
      const args = Object.entries(ev.args || {});
      if (n.kind === "tool") { state.stats.tools += 1; setSub(ev.node, args.map(([, v]) => v).join(", ")); }
      else if (ev.node !== "input" && ev.node !== "output") setSub(ev.node, "running…");
      if (ev.node !== "input" && ev.node !== "output" && ev.fn !== "chat") {
        trace(el("div", {}, stamp(ev.t), el("span", { class: "who", text: `▶ ${n.label}` }),
          args.length ? el("div", { class: "args", dir: "auto", text: args.map(([k, v]) => `${k} = ${clip(v, 220)}`).join("\n") }) : null), `k-${n.kind}`);
      }
      break;
    }
    case "exit": {
      const n = state.nodes[ev.node];
      if (!n) break;
      n.last = { ...(n.last || {}), value: ev.value };
      nodeState(ev.node, { active: Math.max(0, n.active - 1), failed: ev.failed, paused: false });
      if (ev.node !== "input") setSub(ev.node, ev.value);
      if (n.kind === "tool" || n.kind === "code") {
        trace(el("div", {}, stamp(ev.t), el("span", { class: "who", text: `↩ ${n.label}` }), el("div", { class: "val", dir: "auto", text: clip(ev.value, 400) })), `k-${n.kind}`);
      }
      break;
    }
    case "edge": lightEdge(ev.from, ev.to); break;
    case "paused": {
      state.paused = ev.node;
      nodeState(ev.node, { paused: true });
      setStatus(`<b>Paused</b> before <b>${labelOf(ev.node)}</b> · press <b>Space</b>`, "paused");
      updateButtons();
      break;
    }
    case "resumed": {
      state.paused = null;
      nodeState(ev.node, { paused: false });
      setStatus(`<b>Running</b> · ${state.mode}`);
      updateButtons();
      break;
    }
    case "line": {
      (state.lines[ev.file] ||= {})[ev.thread] = ev.line;
      (state.seen[ev.file] ||= new Set()).add(ev.line);
      state.lastLine[ev.thread] = { file: ev.file, line: ev.line };
      if (ev.file === state.file) queuePaint(); else markBusyTabs();
      break;
    }
    case "ret": {
      if (state.lines[ev.file]) state.lines[ev.file][ev.thread] = null;
      queuePaint();
      break;
    }
    case "idle": {
      for (const file of Object.keys(state.lines)) if (ev.thread !== 0) state.lines[file][ev.thread] = null;
      queuePaint();
      break;
    }
    case "view": addView(ev); break;
    case "ask": showAsk(ev); break;
    case "answered": {
      $("ask").classList.add("hidden");
      if (state.asking) nodeState(state.asking, { paused: false });
      if (state.asking) setSub(state.asking, ev.answer === "y" ? "yes" : "no");
      trace(el("div", {}, stamp(ev.t), el("span", { class: "who", text: `👤 You answered: ${ev.answer}` })), "k-human");
      state.asking = null;
      break;
    }
    case "llm_start": {
      state.stats.llm += 1;
      if (ev.request.messages) showConversation(ev.request);
      if (ev.node) { const n = state.nodes[ev.node]; nodeState(ev.node, { thinking: (n.thinking || 0) + 1 }); setSub(ev.node, "thinking…"); }
      state.waiting[ev.thread] = state.lastLine[ev.thread];
      state.pendingLLM[ev.thread] = traceLLM(ev);
      queuePaint();
      break;
    }
    case "llm_end": {
      if (ev.node) { const n = state.nodes[ev.node]; nodeState(ev.node, { thinking: Math.max(0, (n.thinking || 1) - 1) }); }
      state.waiting[ev.thread] = null;
      const pending = state.pendingLLM[ev.thread];
      if (pending) {
        pending.reply.className = "reply";
        pending.reply.setAttribute("dir", "auto");
        pending.reply.textContent = "";
        if (ev.reply.text) pending.reply.append(document.createTextNode(clip(ev.reply.text, 1500)));
        if (ev.reply.tool_calls.length) pending.reply.append(el("div", { class: "calls", text: "→ " + ev.reply.tool_calls.join("\n→ ") }));
        pending.entry.querySelector(".t").textContent = `${ev.t.toFixed(1)}s · ${ev.seconds}s`;
      }
      if (state.conversation && state.conversation.pending) addReply(ev.reply);
      if (ev.node && ev.reply.tool_calls.length) setSub(ev.node, "→ " + ev.reply.tool_calls.map((c) => c.split("(")[0]).join(", "));
      queuePaint();
      break;
    }
    case "done": {
      $("diagram").classList.add("finished");
      addCard("Output", el("pre", { class: "output-text", dir: "auto", text: ev.result }), "wide output");
      trace(el("div", {}, stamp(ev.t), el("span", { class: "who", text: "✓ Output" }), el("div", { class: "reply", dir: "auto", text: ev.result })), "done");
      state.lines = {}; state.waiting = {};
      paintLines(false);
      finish(`<b>Done</b> · ${summaryLine()}`);
      break;
    }
    case "error": {
      state.errorAt = ev.file ? { file: ev.file, line: ev.line } : null;
      trace(el("div", {}, stamp(ev.t), el("span", { class: "who", text: "✗ " + ev.message }), el("details", {}, el("summary", { text: "traceback" }), el("pre", { class: "val", text: ev.trace }))), "error");
      if (ev.file && state.wf.files[ev.file] && ev.file !== state.file) { state.file = ev.file; renderTabs(); renderCode(); }
      paintLines();
      finish(`<b>Error</b> · ${ev.message}`, "error");
      break;
    }
    case "stopped": finish("Stopped"); break;
    case "end": if (state.running) finish(""); break;
  }
}

// ---------------------------------------------------------------- controls
function wireControls() {
  $("run").onclick = run;
  $("stop").onclick = stop;
  $("next").onclick = next;
  $("help-btn").onclick = () => $("help").classList.toggle("hidden");
  $("help").onclick = () => $("help").classList.add("hidden");
  $("toggle-sidebar").onclick = () => { state.sidebar = !state.sidebar; applySettings(); };
  for (const b of document.querySelectorAll(".panel-tabs button")) b.onclick = () => { state.panel = b.dataset.panel; state.trace = true; applySettings(); };
  $("reset-task").onclick = () => { $("task").value = state.wf.example; delete state.inputs[state.wf.name]; };
  $("task").addEventListener("input", () => { state.inputs[state.wf.name] = $("task").value; });
  for (const id of ["mode", "speed"]) {
    $(id).addEventListener("click", (ev) => {
      const v = ev.target.dataset.value;
      if (!v) return;
      setOption(id, v);
    });
  }
  $("step").onclick = toggleStep;
  $("ask-yes").onclick = () => answer("y");
  $("ask-no").onclick = () => answer("n");
  document.addEventListener("keydown", onKey);
}

function setOption(id, value) {
  state[id] = value;
  applySettings();
  if (id === "speed") control("speed", value);
}

function toggleStep() {
  state.step = !state.step;
  applySettings();
  control("step", state.step ? "1" : "0");
}

function onKey(ev) {
  if (!$("ask").classList.contains("hidden")) {           // the input() dialog is open
    if (ev.key === "y" || ev.key === "Y") answer("y");
    else if (ev.key === "n" || ev.key === "N") answer("n");
    else if (ev.key === "Escape") stop();
    else return;
    ev.preventDefault();
    return;
  }
  const typing = ev.target.tagName === "TEXTAREA";
  if (typing) {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); ev.target.blur(); run(); }
    if (ev.key === "Escape") ev.target.blur();
    return;
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const speeds = ["slow", "normal", "fast"];
  const files = Object.keys(state.wf.files);
  const key = ev.key;
  if (key === "Enter") run();
  else if (key === " " || key === "ArrowRight") { if (state.paused) next(); else if (!state.running && key === " ") run(); }
  else if (key === "PageDown") { if (state.paused) next(); else select(state.index + 1); }
  else if (key === "ArrowDown") select(state.index + 1);
  else if (key === "ArrowUp" || key === "PageUp") select(state.index - 1);
  else if (key === "Escape") { if (!$("help").classList.contains("hidden")) $("help").classList.add("hidden"); else if (state.running) stop(); }
  else if (key === "s" || key === "S") toggleStep();
  else if (key === "m" || key === "M") setOption("mode", state.mode === "replay" ? "live" : "replay");
  else if (key === "-") setOption("speed", speeds[Math.max(0, speeds.indexOf(state.speed) - 1)]);
  else if (key === "=" || key === "+") setOption("speed", speeds[Math.min(2, speeds.indexOf(state.speed) + 1)]);
  else if (key === "1") { state.layout = "split"; applySettings(); }
  else if (key === "2") { state.layout = "diagram-only"; applySettings(); }
  else if (key === "3") { state.layout = "code-only"; applySettings(); }
  else if (key === "[" || key === "]") {
    const i = (files.indexOf(state.file) + (key === "]" ? 1 : -1) + files.length) % files.length;
    state.file = files[i]; renderTabs(); renderCode();
  }
  else if (key === "l" || key === "L") { state.trace = !state.trace; applySettings(); }
  else if (key === "d" || key === "D") { state.panel = state.panel === "data" ? "trace" : "data"; state.trace = true; applySettings(); }
  else if (key === "b" || key === "B") { state.sidebar = !state.sidebar; applySettings(); }
  else if (key === "t" || key === "T") { state.theme = state.theme === "dark" ? "light" : "dark"; applySettings(); }
  else if (key === "?") $("help").classList.toggle("hidden");
  else return;
  ev.preventDefault();
}

boot();
