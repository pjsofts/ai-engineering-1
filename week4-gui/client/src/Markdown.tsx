// Markdown.tsx — just enough markdown for a coding agent's replies:
// fenced code blocks, inline code, bold, and paragraphs.
//
// Deliberately tiny. The terminal version of this renderer is `console.log`,
// which does none of it — a fair reminder that "the same agent" can still be a
// very different product depending on what the interface can draw.
import React from "react";

function inline(text: string, key: number): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <React.Fragment key={key}>
      {parts.map((p, i) => {
        if (p.startsWith("`") && p.endsWith("`") && p.length > 1)
          return <code key={i}>{p.slice(1, -1)}</code>;
        if (p.startsWith("**") && p.endsWith("**") && p.length > 3)
          return <strong key={i}>{p.slice(2, -2)}</strong>;
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </React.Fragment>
  );
}

export default function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  // Split on fences, keeping them: even indexes are prose, odd are code.
  const chunks = text.split(/```/);

  chunks.forEach((chunk, i) => {
    if (i % 2 === 1) {
      const nl = chunk.indexOf("\n");
      const lang = nl === -1 ? "" : chunk.slice(0, nl).trim();
      const body = nl === -1 ? chunk : chunk.slice(nl + 1);
      blocks.push(
        <pre key={`c${i}`} className="code">
          {lang && <span className="lang">{lang}</span>}
          <code>{body.replace(/\n$/, "")}</code>
        </pre>,
      );
      return;
    }
    chunk.split(/\n{2,}/).forEach((para, j) => {
      if (!para.trim()) return;
      blocks.push(
        <p key={`p${i}-${j}`}>
          {para.split("\n").map((line, k) => (
            <React.Fragment key={k}>
              {k > 0 && <br />}
              {inline(line, k)}
            </React.Fragment>
          ))}
        </p>,
      );
    });
  });

  return <>{blocks}</>;
}
