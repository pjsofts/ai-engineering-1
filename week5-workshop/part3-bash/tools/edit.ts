// tools/edit.ts — the sharpest tool in the box, and therefore the one with the
// most guards.
//
// The design is exact-string replacement: the model hands over an `old_string`
// and a `new_string`, and we swap the first for the second — but only after six
// checks pass. Every guard is here because the failure it prevents WILL happen
// in real use, usually in the first hour.
//
// Why exact-match rather than the alternatives:
//   - "regenerate the whole file" burns tokens, produces an unreviewable diff,
//     and quietly drops the parts of the file the model forgot.
//   - "patch at line 42" breaks the moment any earlier edit shifts the lines.
//   - exact-match is small, reviewable, and fails LOUDLY when the model's idea
//     of the file no longer matches the disk.
import fs from "node:fs";
import { READ_STATE } from "./fs.js";

export interface EditArgs {
  path: string;
  old_string: string;
  new_string: string;
}

export function editFile({ path: p, old_string, new_string }: EditArgs): string {
  // 1. a no-op edit. Costs a whole step and changes nothing.
  if (old_string === new_string) {
    return "<tool_error>old_string and new_string are identical — nothing to do</tool_error>";
  }

  // 2. the file has to exist. write_file creates; edit_file changes.
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
    return `<tool_error>not found: ${p}. Use write_file to create a new file.</tool_error>`;
  }

  // 3. read-before-edit. Without this the model edits its own memory of the file.
  if (!READ_STATE.has(p)) {
    return "<tool_error>this file has not been read yet. Call read_file on it " +
      "first so your edit is based on what is actually there.</tool_error>";
  }

  // 4. staleness. Between the read and the edit, a test run, a formatter or a
  //    human may have changed the file. Applying a stale edit clobbers them.
  if (fs.statSync(p).mtimeMs > READ_STATE.get(p)! + 1e-6) {
    return `<tool_error>${p} changed on disk since you read it. ` +
      `read_file it again before editing.</tool_error>`;
  }

  const text = fs.readFileSync(p, "utf8");
  const count = text.split(old_string).length - 1;

  // 5. no match. The silent killer: without this check the model believes an
  //    edit succeeded and goes on to "verify" a change that never happened.
  if (count === 0) {
    return "<tool_error>old_string was not found. It must match EXACTLY, " +
      "including whitespace and indentation. read_file the region again and " +
      "copy the text verbatim.</tool_error>";
  }

  // 6. ambiguity. Three identical lines and a one-line old_string means we
  //    would edit the first one, which is a coin flip. Make the model decide.
  if (count > 1) {
    return `<tool_error>old_string appears ${count} times in ${p}. Include ` +
      `surrounding lines to make it unique.</tool_error>`;
  }

  fs.writeFileSync(p, text.replace(old_string, new_string));
  // Re-arm rather than clear: two edits in a row to the same file are normal,
  // and the second one should not be rejected as stale by the first.
  READ_STATE.set(p, fs.statSync(p).mtimeMs);

  // Terse on purpose. The diff is for the human, drawn by the interface from
  // the arguments it already has. Echoing it back to the model is paying twice
  // for text it wrote itself.
  return `edited ${p}`;
}
