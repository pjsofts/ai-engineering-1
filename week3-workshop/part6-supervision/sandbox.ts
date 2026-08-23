// sandbox.ts — ONE place model-written code runs. The vm context gets a frozen
// little world: the tools API and console.log — no require, no process, no fs,
// no fetch, because they're simply not in the context. The timeout kills
// runaway SYNCHRONOUS code; a race backstops async hangs. Honest limit: this
// stops accidents, not a determined attacker — production runs untrusted code
// in a disposable micro-VM or container. The harness's job is the same either
// way: route every dangerous capability through one mediated boundary.
import vm from "node:vm";
export interface SandboxResult { ok: boolean; result?: unknown; error?: string; logs: string[]; }
export type SandboxAPI = Record<string, (...args: any[]) => unknown>;
export async function runInSandbox(
  code: string, api: SandboxAPI, timeoutMs = 2000): Promise<SandboxResult> {
  const logs: string[] = [];
  const context = vm.createContext({
    tools: api,
    console: { log: (...args: unknown[]) => logs.push(args.map(String).join(" ")) },
  });
  // Run the model's code as an async function body so it can `return` a result.
  const wrapped = `(async () => { ${code} })()`;
  try {
    // `timeout` bounds the SYNC portion (an infinite loop dies here) ...
    const promise = vm.runInContext(wrapped, context, { timeout: timeoutMs });
    // ... and the race backstops async hangs. (vm can't truly KILL leaked async
    // work — a real isolate can. We still hand the model a clean error.)
    const result = await Promise.race([promise,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error(`execution timed out after ${timeoutMs}ms`)), timeoutMs)),
    ]);
    return { ok: true, result, logs };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), logs };
  }
}
