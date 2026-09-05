// ToolCall.tsx — the receipt for one tool call.
//
// The terminal prints two lines per call: what it did, and how it went. The
// browser can afford more, so it shows the arguments as the thing they actually
// are — a command as a command, an edit as a diff — and hides the raw result
// behind a disclosure triangle.
//
// The rule underneath is the same in both interfaces: the MODEL gets the whole
// result, the HUMAN gets a summary they can scan in half a second. An interface
// that dumps 2,000 lines of grep output into the transcript is not being
// transparent, it is being unreadable.
import { useState } from "react";

export interface ToolRun {
  id: string;
  name: string;
  args: Record<string, any>;
  result?: string;
  ms?: number;
  decision?: "allow" | "ask" | "deny";
  why?: string;
}

const ICON: Record<string, string> = {
  read_file: "◇", write_file: "◆", edit_file: "✎",
  run_bash: "$", glob_files: "❯", grep_search: "⌕",
};

export function summarise(name: string, args: Record<string, any>): string {
  switch (name) {
    case "read_file": return String(args.path ?? "");
    case "write_file": return `${args.path} · ${String(args.content ?? "").length} chars`;
    case "edit_file": return String(args.path ?? "");
    case "run_bash": return String(args.command ?? "");
    case "glob_files": return String(args.pattern ?? "");
    case "grep_search": return `/${args.pattern}/${args.glob && args.glob !== "*" ? ` in ${args.glob}` : ""}`;
    default: return JSON.stringify(args).slice(0, 90);
  }
}

/** The two-colour diff an edit_file call amounts to. */
export function Diff({ oldText, newText }: { oldText: string; newText: string }) {
  return (
    <pre className="diff">
      {oldText.split("\n").map((l, i) => <div key={`o${i}`} className="del">- {l}</div>)}
      {newText.split("\n").map((l, i) => <div key={`n${i}`} className="add">+ {l}</div>)}
    </pre>
  );
}

export default function ToolCall({ run, running }: { run: ToolRun; running: boolean }) {
  const [open, setOpen] = useState(false);
  const failed = !!run.result?.startsWith("<tool_error>");
  const denied = failed && run.result!.includes("denied");
  const lines = run.result ? run.result.split("\n").length : 0;

  return (
    <div className={`tool ${running ? "running" : ""} ${failed ? "failed" : ""} ${denied ? "denied" : ""}`}>
      <div className="head" onClick={() => run.result && setOpen(!open)}>
        <span className="icon">{ICON[run.name] ?? "•"}</span>
        <span className="name">{run.name}</span>
        <span className="arg">{summarise(run.name, run.args)}</span>
        {run.decision === "allow" && run.why && <span className="tag auto">{run.why}</span>}
        {run.decision === "ask" && !failed && <span className="tag ok">you approved</span>}
        {denied && <span className="tag no">denied</span>}
        {running
          ? <span className="tag live">running…</span>
          : <span className="ms">{run.ms}ms</span>}
      </div>

      {run.name === "edit_file" && (
        <Diff oldText={String(run.args.old_string ?? "")} newText={String(run.args.new_string ?? "")} />
      )}

      {run.result && (
        <>
          <button className="peek" onClick={() => setOpen(!open)}>
            {open ? "hide" : failed ? "see the error" : `see what the model got · ${lines} line${lines === 1 ? "" : "s"}`}
          </button>
          {open && <pre className="result">{run.result}</pre>}
        </>
      )}
    </div>
  );
}
