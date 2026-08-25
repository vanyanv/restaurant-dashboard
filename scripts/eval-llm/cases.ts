/**
 * The frozen golden set.
 *
 * Every input here is a literal. No database, no clock, no `new Date()`. That
 * is not tidiness — it is the difference between an eval and a weather report.
 * A case whose input moves cannot tell you whether a change in the score came
 * from your prompt edit or from Tuesday being slow.
 *
 * Cases were chosen for the failure each one would catch, not for coverage of
 * the happy path. Where a case exists to pin a specific rule the prompt states,
 * the comment says which rule.
 */

import type { VerdictFacts } from "@/app/dashboard/(editorial)/decisions/lib/verdict-copy"
import type { AdjudicatorCase } from "@/lib/ingredient-match-llm"
import type {
  ExpectedAdjudication,
  ExpectedProposal,
  VerdictExpectation,
} from "./graders"

// --- narrated verdict ----------------------------------------------------------

export interface VerdictCase {
  id: string
  facts: VerdictFacts
  expect: VerdictExpectation
  /** Why this case is in the set. */
  why: string
}

const baseFacts: VerdictFacts = {
  storeName: "Hollywood",
  isAggregate: false,
  weekTotal: 56000,
  weekP10: 49000,
  weekP90: 63000,
  peakDay: { weekdayShort: "SAT", predictedRevenue: 9240 },
  laborGapHours: -11,
  laborStatus: "short",
  shortDays: 2,
  unscheduledDays: 0,
  topAction: { title: "Reprice the Double Slider", impactUsdPerWeek: 640 },
  potUsdPerWeek: 2140,
  accuracyWape: 0.064,
  accuracySample: 26,
  topBriefing: null,
}

const f = (over: Partial<VerdictFacts>): VerdictFacts => ({ ...baseFacts, ...over })

export const VERDICT_CASES: VerdictCase[] = [
  {
    id: "short-staffed-big-saturday",
    facts: f({}),
    expect: { mustContain: ["$9,240"] },
    why: "The ordinary week. Must lead with the day the owner acts on, not with forecast accuracy.",
  },
  {
    id: "overstaffed",
    facts: f({ laborGapHours: 14, laborStatus: "heavy", shortDays: 0 }),
    expect: { mustContain: ["$9,240"] },
    why: "Sign flip. A narrator that reads every gap as 'short' passes the first case and fails here.",
  },
  {
    id: "no-schedule-published",
    facts: f({
      laborGapHours: null,
      laborStatus: "unknown",
      shortDays: 0,
      unscheduledDays: 5,
    }),
    expect: { mustContain: ["$9,240"] },
    why: "labor_gap_hours is absent from the block entirely. The model must not fill the hole.",
  },
  {
    id: "briefing-leads",
    facts: f({
      topBriefing: "Beef patty cost rose 18% at Sysco, which puts the Double Slider under 60% margin.",
    }),
    expect: {},
    why: "A pre-written sentence outranks the forecast. Its figures are in the block, so quoting them must be allowed.",
  },
  {
    id: "no-forecast-yet",
    facts: f({
      weekTotal: null,
      weekP10: null,
      weekP90: null,
      peakDay: null,
      accuracyWape: null,
      accuracySample: 0,
      potUsdPerWeek: 0,
      topAction: null,
      laborGapHours: null,
      laborStatus: "unknown",
      shortDays: 0,
      unscheduledDays: 7,
    }),
    expect: {},
    why: "Almost nothing in the block. The strongest hallucination pressure in the set — a model asked to open a page with no facts.",
  },
  {
    id: "aggregate-all-stores",
    facts: f({ storeName: "All stores", isAggregate: true, weekTotal: 91500, peakDay: { weekdayShort: "FRI", predictedRevenue: 15800 } }),
    expect: { mustContain: ["$15,800"] },
    why: "Aggregate wording. Also checks the model copies the new figures rather than the ones it saw in a sibling case.",
  },
  {
    id: "large-action-pot",
    facts: f({
      laborGapHours: 0,
      laborStatus: "level",
      shortDays: 0,
      potUsdPerWeek: 8400,
      topAction: { title: "Drop the 20% DoorDash promo", impactUsdPerWeek: 3100 },
    }),
    expect: {},
    why: "Nothing wrong with labor, so the lead has to move to the money on the table.",
  },
  {
    id: "warming-up-store",
    facts: f({
      storeName: "Glendale",
      weekTotal: 4100,
      weekP10: 1900,
      weekP90: 7300,
      peakDay: { weekdayShort: "SUN", predictedRevenue: 820 },
      accuracyWape: 0.41,
      accuracySample: 6,
      potUsdPerWeek: 0,
      topAction: null,
    }),
    expect: { mustContain: ["$820"] },
    why: "A band nearly as wide as the forecast. The narrator must not present it as a confident number.",
  },
]

// --- recipe proposals ----------------------------------------------------------

const RECIPE_VOCAB = [
  { itemName: "Double Slider", category: "Sliders" },
  { itemName: "Single Slider", category: "Sliders" },
  { itemName: "Chicken Slider", category: "Sliders" },
  { itemName: "Fries", category: "Sides" },
  { itemName: "Cheese Fries", category: "Sides" },
  { itemName: "Onion Rings", category: "Sides" },
  { itemName: "Fountain Drink", category: "Drinks" },
  { itemName: "Milkshake", category: "Drinks" },
]

const INGREDIENT_VOCAB = [
  "Beef Patty",
  "Slider Bun",
  "American Cheese",
  "Grilled Onion",
  "Pickle Chip",
  "Russet Potato",
  "Yellow Onion",
  "Chicken Breast",
  "Vanilla Ice Cream",
  "Whole Milk",
]

export interface ProposalCase {
  id: string
  input: {
    items: { itemName: string; category: string; qty30d: number }[]
    recipeVocab: { itemName: string; category: string }[]
    ingredientVocab: string[]
    confirmedExamples?: { itemName: string; recipeName: string }[]
  }
  expect: ExpectedProposal[]
  why: string
}

export const PROPOSAL_CASES: ProposalCase[] = [
  {
    id: "combo-composes-existing-recipes",
    input: {
      items: [{ itemName: "2 Slider Combo", category: "Combos", qty30d: 310 }],
      recipeVocab: RECIPE_VOCAB,
      ingredientVocab: INGREDIENT_VOCAB,
    },
    expect: [
      {
        itemName: "2 Slider Combo",
        kind: "COMBO_DECOMPOSITION",
        allComponentsAreRecipes: true,
      },
    ],
    why:
      "The prompt's load-bearing rule. Flattening to Beef Patty x4 parses cleanly and breaks cost roll-up forever. " +
      "Graded on shape, not on a bill of materials: the first run returned two Single Sliders where this case said " +
      "one Double Slider, and the name is ambiguous enough that the label was the thing that was wrong.",
  },
  {
    id: "combo-with-an-unambiguous-name",
    input: {
      items: [{ itemName: "Double Slider Combo", category: "Combos", qty30d: 180 }],
      recipeVocab: RECIPE_VOCAB,
      ingredientVocab: INGREDIENT_VOCAB,
    },
    expect: [
      {
        itemName: "Double Slider Combo",
        kind: "COMBO_DECOMPOSITION",
        componentNames: ["Double Slider", "Fries", "Fountain Drink"],
      },
    ],
    why: "The exact-composition test the case above was trying to be, on a name with only one reading. Keeps the harness able to catch a wrong component, not only a wrong shape.",
  },
  {
    id: "rename-is-a-match-not-a-new-recipe",
    input: {
      items: [{ itemName: "DBL SLIDER", category: "Sliders", qty30d: 1200 }],
      recipeVocab: RECIPE_VOCAB,
      ingredientVocab: INGREDIENT_VOCAB,
      confirmedExamples: [{ itemName: "CHKN SLIDER", recipeName: "Chicken Slider" }],
    },
    expect: [
      { itemName: "DBL SLIDER", kind: "MATCH", matchRecipeName: "Double Slider" },
    ],
    why: "A POS abbreviation of something that already exists. NEW_RECIPE here duplicates the recipe and splits its sales history.",
  },
  {
    id: "genuinely-new-item-falls-back-to-ingredients",
    input: {
      items: [{ itemName: "Jalapeno Popper Basket", category: "Sides", qty30d: 45 }],
      recipeVocab: RECIPE_VOCAB,
      ingredientVocab: INGREDIENT_VOCAB,
    },
    expect: [{ itemName: "Jalapeno Popper Basket", kind: "NEW_RECIPE" }],
    why: "Nothing in the vocabulary is this. Forcing a MATCH to Onion Rings would be a confident wrong link.",
  },
  {
    id: "mixed-batch-keeps-items-apart",
    input: {
      items: [
        { itemName: "CHS FRIES", category: "Sides", qty30d: 500 },
        { itemName: "Slider Party Pack", category: "Combos", qty30d: 22 },
      ],
      recipeVocab: RECIPE_VOCAB,
      ingredientVocab: INGREDIENT_VOCAB,
    },
    expect: [
      { itemName: "CHS FRIES", kind: "MATCH", matchRecipeName: "Cheese Fries" },
      { itemName: "Slider Party Pack", kind: "COMBO_DECOMPOSITION" },
    ],
    why: "Two items, two different verdicts, one call. Batching is where a model starts applying one item's answer to the next.",
  },
]

// --- invoice-line adjudication -------------------------------------------------

export interface AdjudicatorEvalCase {
  id: string
  cases: AdjudicatorCase[]
  expect: ExpectedAdjudication[]
  why: string
}

export const ADJUDICATOR_CASES: AdjudicatorEvalCase[] = [
  {
    id: "obvious-match-and-obvious-miss",
    cases: [
      {
        caseId: "a1",
        productName: "TOMATO ROMA 25# CS",
        vendorName: "Sysco",
        unit: "case",
        candidates: [
          { name: "Roma Tomato", score: 0.93 },
          { name: "Tomato Paste", score: 0.61 },
          { name: "Cherry Tomato", score: 0.58 },
        ],
      },
      {
        caseId: "a2",
        productName: "GLOVE NITRILE PWDR FREE LG",
        vendorName: "Sysco",
        unit: "case",
        candidates: [
          { name: "Roma Tomato", score: 0.09 },
          { name: "Slider Bun", score: 0.07 },
        ],
      },
    ],
    expect: [
      { caseId: "a1", matchName: "Roma Tomato" },
      { caseId: "a2", matchName: null },
    ],
    why: "The batch's core contract: one confident link, one refusal, in the same call. A model that never says 'none of these' silently pollutes the pantry.",
  },
  {
    id: "no-cross-case-borrowing",
    cases: [
      {
        caseId: "b1",
        productName: "CHEESE AMERICAN SLICED 5#",
        vendorName: "US Foods",
        unit: "case",
        candidates: [
          { name: "American Cheese", score: 0.9 },
          { name: "Cheddar Cheese", score: 0.72 },
        ],
      },
      {
        caseId: "b2",
        productName: "CHEESE CHEDDAR SHRED 5#",
        vendorName: "US Foods",
        unit: "case",
        candidates: [{ name: "American Cheese", score: 0.71 }],
      },
    ],
    expect: [
      { caseId: "b1", matchName: "American Cheese" },
      { caseId: "b2", matchName: null },
    ],
    why: "Cheddar's own shortlist does not contain Cheddar. The right answer is null; reaching into b1's list for it is the exact rule the prompt states twice.",
  },
  {
    id: "near-miss-variant",
    cases: [
      {
        caseId: "c1",
        productName: "POTATO RUSSET 50# BAG",
        vendorName: "Produce Direct",
        unit: "bag",
        candidates: [
          { name: "Russet Potato", score: 0.94 },
          { name: "Sweet Potato", score: 0.66 },
          { name: "Yellow Onion", score: 0.31 },
        ],
      },
      {
        caseId: "c2",
        productName: "POTATO SWEET 40# BAG",
        vendorName: "Produce Direct",
        unit: "bag",
        candidates: [
          { name: "Russet Potato", score: 0.88 },
          { name: "Sweet Potato", score: 0.92 },
        ],
      },
    ],
    expect: [
      { caseId: "c1", matchName: "Russet Potato" },
      { caseId: "c2", matchName: "Sweet Potato" },
    ],
    why: "Two products whose shortlists overlap and whose similarity scores nearly tie. Ranking by score alone gets c2 wrong.",
  },
  {
    id: "packaging-noise-does-not-change-the-ingredient",
    cases: [
      {
        caseId: "d1",
        productName: "ONION YELLOW JUMBO 50LB SACK",
        vendorName: "Produce Direct",
        unit: "sack",
        candidates: [
          { name: "Yellow Onion", score: 0.89 },
          { name: "Grilled Onion", score: 0.77 },
        ],
      },
    ],
    expect: [{ caseId: "d1", matchName: "Yellow Onion" }],
    why: "Raw stock, not the prepped component. Picking 'Grilled Onion' is the mis-link that inflates a prepped ingredient's cost per unit.",
  },
]

// --- chat tool choice ----------------------------------------------------------

/**
 * A frozen store list and situation snapshot for the system prompt.
 *
 * Deliberately not the real ones. The eval asks "given this world, does the
 * agent reach for the right tool" — a system prompt built from live production
 * data would make yesterday's score unreproducible.
 */
export const CHAT_CONTEXT = {
  today: "2026-08-21",
  storeBlock: [
    "- Hollywood (id: 11111111-1111-1111-1111-111111111111) — open",
    "- Glendale (id: 22222222-2222-2222-2222-222222222222) — in construction",
    "- Van Nuys (id: 33333333-3333-3333-3333-333333333333) — in construction",
  ].join("\n"),
  snapshot: [
    "Hollywood: yesterday $8,120 net sales across 214 orders.",
    "Glendale, Van Nuys: not trading yet.",
  ].join("\n"),
}

export interface ToolChoiceCase {
  id: string
  question: string
  /** Any one of these is an acceptable first move. Empty means: call nothing. */
  expectedTools: string[]
  why: string
}

export const TOOL_CHOICE_CASES: ToolChoiceCase[] = [
  {
    id: "sales-last-week",
    question: "What were my sales last week?",
    expectedTools: ["getDailySales", "compareSales"],
    why: "The single most common question the product answers. compareSales is listed because it answers this too, with context — the first run marked it wrong and the expectation was what was wrong.",
  },
  {
    id: "period-comparison",
    question: "Compare this month's sales to last month's.",
    expectedTools: ["compareSales", "getDailySales"],
    why: "There is a purpose-built comparison tool. Falling back to two raw pulls is a regression in answer quality, not correctness.",
  },
  {
    id: "hourly-pattern",
    question: "What hours are we busiest?",
    expectedTools: ["getHourlyTrend"],
    why: "Daily totals cannot answer this. A model that reaches for getDailySales will confabulate an hour.",
  },
  {
    id: "platform-mix",
    question: "How much of last month came through DoorDash versus in-house?",
    expectedTools: ["getPlatformBreakdown"],
    why: "Channel split lives in one tool. 58 tools is enough for this to be a real routing decision.",
  },
  {
    id: "margin-ranking",
    question: "Which menu items make me the least money per order?",
    expectedTools: ["rankRecipes", "getMenuMargin", "getCogsByItem"],
    why: "Margin needs recipe cost joined to price. Answering from getTopMenuItems would rank by volume and read as an answer.",
  },
  {
    id: "invoice-lookup",
    question: "What did I spend at Sysco in July?",
    expectedTools: ["getInvoiceSpend", "searchInvoices", "sumInvoiceLines"],
    why: "Vendor spend. The near-miss is getOperationalCosts, which is a different denominator.",
  },
  {
    id: "ingredient-price-move",
    question: "Has the price of beef patties gone up?",
    expectedTools: ["getIngredientPriceHistory", "getIngredientPrice", "searchCanonicalIngredients"],
    why: "'Gone up' is a history question. The price-today tool answers it wrongly and confidently.",
  },
  {
    id: "forecast-next-week",
    question: "What are we forecast to do next week?",
    expectedTools: ["getRevenueForecast"],
    why: "The ML pipeline's whole output. A model that answers this from getDailySales is predicting, which is the one thing it must never do.",
  },
  {
    id: "store-scoping",
    question: "How did Glendale do yesterday?",
    expectedTools: ["getDailySales", "getStoreBreakdown", "compareSales"],
    why: "Glendale is in construction. Any data tool is fine; the failure to catch is answering without one after resolving the name.",
  },
  {
    id: "anomalies",
    question: "Is anything off right now?",
    expectedTools: ["getOpenAnomalies", "getStoreBreakdown", "getDailySales"],
    why: "Open-ended. Tests that a vague question still routes rather than producing a shrug.",
  },
  {
    id: "refunds",
    question: "How much did we refund last month?",
    expectedTools: ["getRefunds"],
    why: "Refunds are their own tool and are netted out of other totals. Answering from sales gives a number that is wrong in a way nobody would notice.",
  },
  {
    id: "out-of-scope-weather",
    question: "What's the weather going to be this weekend?",
    expectedTools: [],
    why: "Not in the warehouse. The agent must say so rather than search 58 tools for something adjacent.",
  },
]
