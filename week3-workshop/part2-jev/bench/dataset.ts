// dataset.ts — hand-labelled eval cases for the three Jev jobs.
// TRIAGE cases grade jobs 1 + 2: the gold category (with `alsoOk` where two
// teams are defensible) and which KB articles a good reply needs (`need`) or
// may use (`ok`). An article outside need ∪ ok counts as a false positive.
// VERIFY cases grade job 3: a draft reply, the articles it was written from,
// and whether it is grounded / on-topic. `tag` says what the case probes.
export type Topic = "billing" | "refund" | "export" | "pricing";
export type Category = "billing" | "technical" | "sales" | "other";

export interface TriageCase { id: string; text: string; category: Category;
  alsoOk?: Category[]; need: Topic[]; ok?: Topic[]; tag: string }
export interface VerifyCase { id: string; customer: string; topics: Topic[];
  draft: string; grounded: boolean; on_topic: boolean; tag: string }

export const TRIAGE: TriageCase[] = [
  // --- billing ---
  { id: "t01", text: "I was charged twice this month.", category: "billing", need: ["billing"], ok: ["refund"], tag: "plain" },
  { id: "t02", text: "My card got billed $40 but my plan is $20, what happened?", category: "billing", need: ["billing"], ok: ["refund"], tag: "paraphrase" },
  { id: "t03", text: "Where can I download last month's invoice?", category: "billing", need: [], ok: ["billing"], tag: "no article fits" },
  { id: "t04", text: "I want a refund for the annual plan I bought yesterday.", category: "billing", need: ["refund"], ok: ["billing"], tag: "plain" },
  { id: "t05", text: "When will my refund show up? It's been a week.", category: "billing", need: ["refund"], tag: "plain" },
  { id: "t06", text: "Two identical pending charges on my statement from you guys", category: "billing", need: ["billing"], ok: ["refund"], tag: "paraphrase" },
  { id: "t07", text: "Ich wurde diesen Monat zweimal belastet, bitte helfen Sie mir.", category: "billing", need: ["billing"], ok: ["refund"], tag: "non-English" },
  { id: "t08", text: "Cancel my subscription and stop charging me", category: "billing", need: [], ok: ["billing", "refund"], tag: "no article fits" },
  { id: "t09", text: "lol got billed 2x again 🙃", category: "billing", need: ["billing"], ok: ["refund"], tag: "slang" },
  // --- technical ---
  { id: "t10", text: "The export button fails on Safari.", category: "technical", need: ["export"], tag: "plain" },
  { id: "t11", text: "Exporting a report on my Mac in Safari just spins forever", category: "technical", need: ["export"], tag: "paraphrase" },
  { id: "t12", text: "The 'Download data' button does nothing when I use Safari", category: "technical", need: ["export"], tag: "no keyword" },
  { id: "t13", text: "I can't log in, it says invalid token.", category: "technical", need: [], tag: "no article fits" },
  { id: "t14", text: "The dashboard charts are blank since this morning's update", category: "technical", need: [], tag: "no article fits" },
  { id: "t15", text: "App crashes when I upload a 2GB file", category: "technical", need: [], tag: "no article fits" },
  { id: "t16", text: "Your pricing page won't load in Safari, it's just a white screen", category: "technical", need: [], ok: ["pricing"], tag: "keyword trap" },
  { id: "t17", text: "Refunds are fine, I don't need one. I just need export to work in Safari.", category: "technical", alsoOk: ["billing"], need: ["export"], tag: "negation" },
  // --- sales ---
  { id: "t18", text: "Can you send pricing for 50 seats?", category: "sales", need: ["pricing"], tag: "plain" },
  { id: "t19", text: "How much would it cost for a team of 30?", category: "sales", need: ["pricing"], tag: "paraphrase" },
  { id: "t20", text: "Do you offer discounts for larger teams?", category: "sales", need: ["pricing"], tag: "paraphrase" },
  { id: "t21", text: "We'd like to go from 10 to 40 seats. What would that run us?", category: "sales", alsoOk: ["billing"], need: ["pricing"], tag: "paraphrase" },
  { id: "t22", text: "Can we get a formal quote for our procurement team?", category: "sales", need: [], ok: ["pricing"], tag: "plain" },
  { id: "t23", text: "Is there an enterprise plan with SSO?", category: "sales", need: [], ok: ["pricing"], tag: "no article fits" },
  { id: "t24", text: "Not a bug report, just curious: what does one seat cost?", category: "sales", need: ["pricing"], tag: "negation" },
  { id: "t25", text: "¿Cuánto cuesta el plan de equipo por usuario?", category: "sales", need: ["pricing"], tag: "non-English" },
  // --- other ---
  { id: "t26", text: "Just wanted to say your product is great!", category: "other", need: [], tag: "plain" },
  { id: "t27", text: "Are you hiring frontend engineers?", category: "other", need: [], tag: "plain" },
  { id: "t28", text: "What's your office address for sending a letter?", category: "other", need: [], tag: "plain" },
  { id: "t29", text: "Can I come on your podcast to talk about data exports?", category: "other", need: [], tag: "keyword trap" },
  { id: "t30", text: "My friend says you charge too much. Is that true?", category: "other", alsoOk: ["sales"], need: [], ok: ["pricing"], tag: "keyword trap" },
];

const GOOD_BILLING = "Sorry about the double charge! Double charges are usually a duplicate " +
  "authorization that drops off in 3-5 days. If it has already settled, we'll refund it " +
  "immediately, and refunds post in 5-10 business days.";

export const VERIFY: VerifyCase[] = [
  // --- billing (articles: billing, refund) ---
  { id: "v01", customer: "I was charged twice and need help.", topics: ["billing", "refund"],
    draft: GOOD_BILLING, grounded: true, on_topic: true, tag: "good" },
  { id: "v02", customer: "I was charged twice and need help.", topics: ["billing", "refund"],
    draft: "Sorry about that! The duplicate charge will drop off within 24 hours.",
    grounded: false, on_topic: true, tag: "wrong timeline" },
  { id: "v03", customer: "I was charged twice and need help.", topics: ["billing", "refund"],
    draft: "Apologies! We've added a $50 credit to your account for the trouble.",
    grounded: false, on_topic: true, tag: "invented promise" },
  { id: "v04", customer: "I was charged twice and need help.", topics: ["billing", "refund"],
    draft: "Sorry about that! A billing specialist will look into the double charge and follow up shortly.",
    grounded: true, on_topic: true, tag: "no facts, courteous" },
  { id: "v05", customer: "I was charged twice and need help.", topics: ["billing", "refund"],
    draft: "The Safari export failure is a known bug. Please use Chrome instead.",
    grounded: false, on_topic: false, tag: "wrong item" },
  { id: "v06", customer: "I was charged twice and need help.", topics: ["billing", "refund"],
    draft: "The duplicate charge is a known bug (TICKET-4412) that engineering is fixing.",
    grounded: false, on_topic: true, tag: "conflated facts" },
  { id: "v07", customer: "I was charged twice and need help.", topics: ["billing", "refund"],
    draft: "Double charges always drop off in 3-5 days, so a refund is never needed.",
    grounded: false, on_topic: true, tag: "contradicts KB" },
  { id: "v08", customer: "Ich wurde zweimal belastet.", topics: ["billing", "refund"],
    draft: GOOD_BILLING, grounded: true, on_topic: true, tag: "cross-language" },
  // --- refund ---
  { id: "v09", customer: "When will my refund show up?", topics: ["refund"],
    draft: "Refunds post in 5-10 business days. If you're on a Pro account, we can expedite it.",
    grounded: true, on_topic: true, tag: "good" },
  { id: "v10", customer: "When will my refund show up?", topics: ["refund"],
    draft: "Your refund will arrive tomorrow morning.",
    grounded: false, on_topic: true, tag: "wrong timeline" },
  // --- export ---
  { id: "v11", customer: "The export button fails on Safari.", topics: ["export"],
    draft: "Thanks for reporting this! It's a known bug (TICKET-4412). As a workaround, please use Chrome or the CSV export.",
    grounded: true, on_topic: true, tag: "good" },
  { id: "v12", customer: "The export button fails on Safari.", topics: ["export"],
    draft: "This is tracked as TICKET-9981 and will be fixed in next week's release.",
    grounded: false, on_topic: true, tag: "invented ticket + date" },
  { id: "v13", customer: "The export button fails on Safari.", topics: ["export"],
    draft: "That's a known issue. Switching to Firefox should fix it.",
    grounded: false, on_topic: true, tag: "wrong workaround" },
  { id: "v14", customer: "The export button fails on Safari.", topics: ["export"],
    draft: "We're really sorry for the inconvenience and appreciate your patience. It's a known bug (TICKET-4412); Chrome or the CSV export will work in the meantime.",
    grounded: true, on_topic: true, tag: "good, padded" },
  { id: "v15", customer: "The export button fails on Safari.", topics: ["export", "refund"],
    draft: "Refunds post in 5-10 business days, and Pro accounts can be expedited.",
    grounded: true, on_topic: false, tag: "grounded but off-topic" },
  { id: "v16", customer: "The export button fails on Safari.", topics: ["export"],
    draft: "Team plans are $20/seat/mo with a volume discount at 25+ seats.",
    grounded: false, on_topic: false, tag: "wrong item" },
  // --- pricing ---
  { id: "v17", customer: "Can you send pricing for 50 seats?", topics: ["pricing"],
    draft: "Team plans are $20 per seat per month, and at 50 seats you'd qualify for our volume discount (25+ seats).",
    grounded: true, on_topic: true, tag: "good" },
  { id: "v18", customer: "Can you send pricing for 50 seats?", topics: ["pricing"],
    draft: "Team plans are $15 per seat per month.",
    grounded: false, on_topic: true, tag: "wrong number" },
  { id: "v19", customer: "Can you send pricing for 50 seats?", topics: ["pricing"],
    draft: "Great news: 50 seats gets you 40% off, so it's $12/seat/mo.",
    grounded: false, on_topic: true, tag: "invented discount" },
  { id: "v20", customer: "Can you send pricing for 50 seats?", topics: ["pricing"],
    draft: "At $20/seat/mo, 50 seats comes to $1,000/mo before the volume discount that applies at 25+ seats.",
    grounded: true, on_topic: true, tag: "derived arithmetic" },
  { id: "v21", customer: "Do you offer a free trial?", topics: ["pricing"],
    draft: "Team plans are $20/seat/mo with a volume discount at 25+ seats.",
    grounded: true, on_topic: false, tag: "grounded but off-topic" },
  // --- no articles ---
  { id: "v22", customer: "Are you hiring frontend engineers?", topics: [],
    draft: "Thanks for asking! Someone from our team will follow up with you.",
    grounded: true, on_topic: true, tag: "no facts, courteous" },
  { id: "v23", customer: "Are you hiring frontend engineers?", topics: [],
    draft: "Yes! We have 5 open frontend roles paying $150k, apply by Friday.",
    grounded: false, on_topic: true, tag: "hallucinated facts" },
  { id: "v24", customer: "I can't log in, it says invalid token.", topics: [],
    draft: "Thanks for your interest in our team plans! A sales rep will reach out.",
    grounded: true, on_topic: false, tag: "misread request" },
];
