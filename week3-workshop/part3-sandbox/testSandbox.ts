// testSandbox.ts — exercise the boundary directly, no agent needed.
import { runInSandbox, type SandboxResult } from "./sandbox.js";
import { SANDBOX_API } from "./tools.js";
const show = (label: string, r: SandboxResult) =>
  console.log(`\n${label}\n `, JSON.stringify(r));
// 1. Code Mode: fetch + compute over the tools API in ONE program.
show("1) code mode (fetch, group, dedupe, compute):", await runInSandbox(`
  const charges = await tools.getCharges("cus_88121");
  const groups = {};
  for (const c of charges) (groups[c.amount + "|" + c.description] ??= []).push(c);
  const dupes = Object.values(groups).filter((g) => g.length > 1);
  return { duplicateId: dupes[0][1].id, refund: dupes[0][0].amount / 100 };
`, SANDBOX_API));
// 2. A runaway sync loop is killed by the timeout.
show("2) infinite loop (killed by timeout):",
  await runInSandbox("while (true) {}", SANDBOX_API, 800));
// 3. No host access: require/fs/process simply aren't in the world we built.
show("3) require('fs') (blocked):",
  await runInSandbox(`return require("fs").readdirSync(".")`, SANDBOX_API));
// 4. A plain bug comes back as a STRUCTURED error the model can read and fix.
show("4) a bug (structured error):",
  await runInSandbox("return totallyUndefined.value", SANDBOX_API));
