#!/usr/bin/env node
// sync.mjs — splice real source into BUILD.md.
//
// BUILD.tmpl.md is the authored document. Every code listing in it is a
// placeholder naming a file in one of the part folders, so the guide cannot
// drift from the code that actually runs:
//
//   {{FILE:part1-read-only/session.ts}}                       the whole file
//   {{SLICE:part2-write-edit/tools/fs.ts:export interface}}    marker → end
//   {{SLICE:part5-agent/model.ts:// The prompt:::// Client}}   marker → marker
//
//   node sync.mjs           regenerate BUILD.md
//   node sync.mjs --check    exit 1 if BUILD.md is stale (use it in CI)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, "BUILD.tmpl.md");
const OUT = path.join(HERE, "BUILD.md");

const read = (rel) => {
  const abs = path.join(HERE, rel);
  if (!fs.existsSync(abs)) throw new Error(`sync: no such file: ${rel}`);
  return fs.readFileSync(abs, "utf8").trimEnd();
};

/** Everything from `start` to `end` (exclusive), or to EOF when end is absent. */
function slice(rel, start, end) {
  const text = read(rel);
  const from = text.indexOf(start);
  if (from === -1) throw new Error(`sync: marker not found in ${rel}:\n${start.slice(0, 60)}`);
  if (!end) return text.slice(from).trimEnd();
  const to = text.indexOf(end, from);
  if (to === -1) throw new Error(`sync: end marker not found in ${rel}:\n${end.slice(0, 60)}`);
  return text.slice(from, to).trimEnd();
}

let count = 0;
const rendered = read("BUILD.tmpl.md")
  .replace(/\{\{FILE:([^}]+)\}\}/g, (_, rel) => { count++; return read(rel.trim()); })
  .replace(/\{\{SLICE:([\s\S]+?)\}\}/g, (_, body) => {
    count++;
    const colon = body.indexOf(":");
    const rel = body.slice(0, colon).trim();
    const [start, end] = body.slice(colon + 1).split(":::");
    return slice(rel, start, end);
  }) + "\n";

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== rendered) {
    console.error("BUILD.md is stale — run: node sync.mjs");
    process.exit(1);
  }
  console.log(`BUILD.md is up to date (${count} listings)`);
} else {
  fs.writeFileSync(OUT, rendered);
  console.log(`wrote BUILD.md — ${count} listings spliced from real source`);
}
