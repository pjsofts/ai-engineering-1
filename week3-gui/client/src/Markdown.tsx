import React, { useMemo } from "react";

// A small markdown renderer for agent replies (bold, italics, code, lists,
// headings, links). Everything is HTML-escaped FIRST, so model output can
// never inject markup — we only add the tags we generate ourselves.
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
             '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function render(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let fence: string[] | null = null;

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const openList = (kind: "ul" | "ol") => {
    if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {              // code fence
      if (fence) { out.push(`<pre><code>${esc(fence.join("\n"))}</code></pre>`); fence = null; }
      else { closeList(); fence = []; }
      continue;
    }
    if (fence) { fence.push(line); continue; }

    if (!line.trim()) { closeList(); continue; }      // blank line

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 2, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) { openList("ul"); out.push(`<li>${inline(bullet[1])}</li>`); continue; }

    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) { openList("ol"); out.push(`<li>${inline(numbered[1])}</li>`); continue; }

    if (list) { out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, `<br />${inline(line.trim())}</li>`); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  if (fence) out.push(`<pre><code>${esc(fence.join("\n"))}</code></pre>`);
  closeList();
  return out.join("");
}

export default function Markdown({ text }: { text: string }) {
  const html = useMemo(() => render(text), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
