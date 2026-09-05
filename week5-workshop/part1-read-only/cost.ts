// cost.ts — the bill is a feature.
//
// Three things make an agent's cost invisible, and all three are fixable:
//   1. Prices are quoted per MILLION tokens, so every number looks like zero.
//   2. Input and output are billed at different rates (output is 4-8x).
//   3. Cached input is billed at a discount — but only if you can see that a
//      cache hit happened at all.
//
// Claude Code's src/utils/modelCost.ts keeps FIVE meters (input, output,
// cache-write, cache-read, web-search) for exactly this reason. We keep three,
// which is all the Chat Completions API reports.
//
// Prices in USD per 1,000,000 tokens, as of 2026-08.
export interface ModelCosts {
  input: number;
  cachedInput: number;
  output: number;
}

const PRICES: Record<string, ModelCosts> = {
  "gpt-4o-mini":  { input: 0.15, cachedInput: 0.075, output: 0.60 },
  "gpt-4o":       { input: 2.50, cachedInput: 1.25,  output: 10.00 },
  "gpt-4.1-mini": { input: 0.40, cachedInput: 0.10,  output: 1.60 },
  "gpt-4.1":      { input: 2.00, cachedInput: 0.50,  output: 8.00 },
};

const FALLBACK: ModelCosts = PRICES["gpt-4o-mini"];

/**
 * Look up a model's prices. Unknown models fall back rather than throw — a
 * cost meter that crashes the app is worse than a cost meter that is wrong,
 * so we return a price AND tell the truth about it.
 */
export function getModelCosts(model: string): { costs: ModelCosts; known: boolean } {
  const exact = PRICES[model];
  if (exact) return { costs: exact, known: true };
  // "gpt-4o-mini-2024-07-18" → try the longest registered prefix.
  const prefix = Object.keys(PRICES)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return { costs: PRICES[prefix], known: true };
  return { costs: FALLBACK, known: false };
}

export interface Usage {
  input: number;         // billed at full rate (already excludes cached)
  cachedInput: number;   // billed at the discount rate
  output: number;
}

export const ZERO: Usage = { input: 0, cachedInput: 0, output: 0 };

export function tokensToUSD(usage: Usage, model: string): number {
  const { costs } = getModelCosts(model);
  return (
    (usage.input       * costs.input) / 1_000_000 +
    (usage.cachedInput * costs.cachedInput) / 1_000_000 +
    (usage.output      * costs.output) / 1_000_000
  );
}

/** Sub-cent numbers need more decimals than money usually does. */
export function formatUSD(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Running totals for a session. One instance, mutated per turn. */
export class CostMeter {
  readonly model: string;
  readonly startedAt = Date.now();
  turns = 0;
  total: Usage = { ...ZERO };
  last: Usage = { ...ZERO };

  constructor(model: string) {
    this.model = model;
  }

  record(usage: Usage): void {
    this.turns++;
    this.last = usage;
    this.total = {
      input: this.total.input + usage.input,
      cachedInput: this.total.cachedInput + usage.cachedInput,
      output: this.total.output + usage.output,
    };
  }

  get lastUSD(): number { return tokensToUSD(this.last, this.model); }
  get totalUSD(): number { return tokensToUSD(this.total, this.model); }

  /** The one-line footer printed after every turn. */
  turnLine(): string {
    const u = this.last;
    const cached = u.cachedInput ? ` (+${u.cachedInput} cached)` : "";
    return `${u.input} in${cached} · ${u.output} out · ${formatUSD(this.lastUSD)}` +
      ` · session ${formatUSD(this.totalUSD)}`;
  }
}
