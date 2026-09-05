// Approval.tsx — the moment the agent stops and waits for a person.
//
// Somewhere on the server there is a promise that is not going to resolve until
// somebody clicks one of these three buttons. That is worth staring at for a
// second: an autonomous system, halted, because a human has not looked yet.
//
// The design rules are the same as the terminal's y/a/N box, and they are not
// cosmetic:
//   - show the EXACT thing that will happen: the command, or the diff. Never a
//     summary like "the agent wants to modify a file".
//   - deny is the default and the safest key. Nothing here is pre-selected.
//   - "always" has to say what it will cover — "every npm command", not "yes to
//     everything, somehow, forever".
import { Diff } from "./ToolCall";

export interface ApprovalRequest {
  id: string;
  name: string;
  args: Record<string, any>;
  why: string;
}

/** What saying "always" would actually allowlist. Say it out loud. */
export function alwaysMeans(req: ApprovalRequest): string {
  if (req.name === "run_bash") {
    const program = String(req.args.command ?? "").trim().split(/\s+/)[0] || "that program";
    return `every ${program} command this session`;
  }
  return `every ${req.name} call this session`;
}

export default function Approval({
  request, answer, onAnswer,
}: {
  request: ApprovalRequest;
  answer?: "yes" | "always" | "no";
  onAnswer: (choice: "yes" | "always" | "no") => void;
}) {
  const { name, args, why } = request;

  return (
    <div className={`approval ${answer ? `answered ${answer}` : "pending"}`}>
      <div className="ask">
        <span className="dot" />
        <b>{name}</b>
        <span className="why">{why}</span>
      </div>

      {name === "run_bash" && <pre className="cmd">$ {args.command}</pre>}
      {name === "edit_file" && (
        <>
          <div className="path">{args.path}</div>
          <Diff oldText={String(args.old_string ?? "")} newText={String(args.new_string ?? "")} />
        </>
      )}
      {name === "write_file" && (
        <>
          <div className="path">
            {args.path} <span className="dim">· {String(args.content ?? "").length} chars</span>
          </div>
          <pre className="diff">
            {String(args.content ?? "").split("\n").slice(0, 12).map((l, i) => (
              <div key={i} className="add">+ {l}</div>
            ))}
          </pre>
        </>
      )}

      {answer ? (
        <div className="verdict">
          {answer === "no" ? "you denied this" : answer === "always" ? `allowed — ${alwaysMeans(request)}` : "you allowed this once"}
        </div>
      ) : (
        <div className="buttons">
          <button className="yes" onClick={() => onAnswer("yes")}>Allow once <kbd>y</kbd></button>
          <button className="always" onClick={() => onAnswer("always")} title={alwaysMeans(request)}>
            Always <kbd>a</kbd>
          </button>
          <button className="no" onClick={() => onAnswer("no")}>Deny <kbd>n</kbd></button>
          <span className="hint">{alwaysMeans(request)}</span>
        </div>
      )}
    </div>
  );
}
