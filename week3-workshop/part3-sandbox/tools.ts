// tools.ts — Part 3 additions: canned charge data (note the planted duplicate),
// the read-only API the sandbox exposes, and the runCode tool. The code only
// gets READ tools — so replaying it after a crash is harmless, and the
// side-effecting sendReply stays a normal exactly-once durable call.
import type OpenAI from "openai";
import { runInSandbox, type SandboxAPI } from "./sandbox.js";
export type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

const KNOWLEDGE_BASE: Record<string, string> = {
  billing: "Double charges are usually a duplicate authorization that " +
           "drops off in 3-5 days. If it already settled, refund immediately.",
  refund: "Refunds post in 5-10 business days. Pro accounts can be expedited.",
  export: "The Safari export failure is a known bug (TICKET-4412). " +
          "Workaround: use Chrome or the CSV export.",
  pricing: "Team plans are $20/seat/mo with a volume discount at 25+ seats.",
};

export function searchKB(query: string): string[] {
  const q = query.toLowerCase();
  const hits = Object.entries(KNOWLEDGE_BASE)
    .filter(([key]) => q.includes(key)).map(([, article]) => article);
  return hits.length ? hits : ["No exact match - use your judgment."];
}

export interface Charge { id: string; amount: number; date: string; description: string; }
export const CHARGES: Record<string, Charge[]> = {
  cus_88121: [
    { id: "ch_001", amount: 4900, date: "2026-05-01", description: "Pro plan - monthly" },
    { id: "ch_002", amount: 4900, date: "2026-05-01", description: "Pro plan - monthly" },
    { id: "ch_003", amount: 1500, date: "2026-04-18", description: "Extra seats" },
  ],
};

export const SANDBOX_API: SandboxAPI = {
  getCharges: async (customerId: string) => CHARGES[customerId] ?? [],
  searchKnowledgeBase: async (query: string) => searchKB(query),
};

const fn = (name: string, description: string,
            properties: Record<string, unknown>, required: string[]): Tool => ({
  type: "function", function: { name, description,
    parameters: { type: "object", properties, required } } });

export const TOOLS: Tool[] = [
  fn("searchKnowledgeBase", "Search the support knowledge base.",
     { query: { type: "string" } }, ["query"]),
  fn("classifyItem", "Classify a work item into a category.",
     { item_id: { type: "string" },
       category: { type: "string",
                   enum: ["billing", "technical", "sales", "other"] } },
     ["item_id", "category"]),
  fn("draftReply", "Write a draft reply for a work item. Does not send anything.",
     { item_id: { type: "string" }, message: { type: "string" } },
     ["item_id", "message"]),
  fn("sendReply", "Send the drafted reply to the customer. This really emails them.",
     { item_id: { type: "string" }, draft_id: { type: "string" } },
     ["item_id", "draft_id"]),
  fn("runCode",
     "Run a JavaScript program (an async function body) to fetch and analyze data. Available inside:\n" +
     "  await tools.getCharges(customerId) -> [{id, amount (cents), date, description}]\n" +
     "  await tools.searchKnowledgeBase(query) -> [string]\n" +
     "  console.log(...) for debugging\n" +
     "IMPORTANT: the code MUST end with a `return` statement (any JSON value) -\n" +
     "  e.g. `return { duplicateId, refund }` - otherwise the result is lost.",
     { code: { type: "string" } }, ["code"]),
];

// The executor — now async: runCode awaits the sandbox. The model's code NEVER
// runs in the host process.
export async function runTool(name: string, args: Record<string, any>): Promise<string> {
  switch (name) {
    case "searchKnowledgeBase":
      return JSON.stringify({ articles: searchKB(args.query) });
    case "classifyItem":
      return JSON.stringify({ ok: true, item_id: args.item_id, category: args.category });
    case "draftReply":
      return JSON.stringify({ ok: true, draft_id: `draft-${args.item_id}` });
    case "sendReply":  // DANGEROUS: irreversible, zero confirmation (for now)
      return JSON.stringify({ sent: true, item_id: args.item_id, draft_id: args.draft_id });
    case "runCode": {
      const r = await runInSandbox(args.code, SANDBOX_API);
      if (r.ok && r.result === undefined)   // a resultless run reads as silence —
        (r as any).hint =                   // give the model something to FIX
          "your code returned no value - end with `return <result>`";
      return JSON.stringify(r);
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
