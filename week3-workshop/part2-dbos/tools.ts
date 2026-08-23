// tools.ts — the crash-test dummy's toolbox: fake but realistic support-triage
// tools. The point in Part 1: they run with NO mediation. sendReply "emails
// the customer" the instant the model asks — no sandbox, no policy, no
// approval. That recklessness is what the rest of the week exists to fix.
import type OpenAI from "openai";
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
];

// The executor: the HARNESS runs tools, not the SDK. That ownership is the
// hook everything else hangs off — Part 2 checkpoints each call, Part 3 routes
// code through a sandbox, Part 7 gates the dangerous ones behind a human.
export function runTool(name: string, args: Record<string, any>): string {
  switch (name) {
    case "searchKnowledgeBase":
      return JSON.stringify({ articles: searchKB(args.query) });
    case "classifyItem":
      return JSON.stringify({ ok: true, item_id: args.item_id, category: args.category });
    case "draftReply":
      return JSON.stringify({ ok: true, draft_id: `draft-${args.item_id}` });
    case "sendReply":  // DANGEROUS: irreversible, zero confirmation (for now)
      return JSON.stringify({ sent: true, item_id: args.item_id, draft_id: args.draft_id });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
