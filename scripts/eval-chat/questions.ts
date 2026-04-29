export type EvalCategory =
  | "sales"
  | "store-summary"
  | "menu"
  | "recipes"
  | "cogs"
  | "ingredients"
  | "invoices"
  | "refunds"
  | "multi-store"
  | "should-refuse"

export interface EvalQuestion {
  id: string
  category: EvalCategory
  question: string
  expectedTools?: string[]
  notes?: string
}

export const QUESTIONS: EvalQuestion[] = [
  // ───────────── sales (8) ─────────────
  {
    id: "sales-last-week",
    category: "sales",
    question: "What were my sales last week?",
    expectedTools: ["getDailySales"],
  },
  {
    id: "sales-last-month",
    category: "sales",
    question: "How much did we do in sales last month?",
    expectedTools: ["getDailySales"],
  },
  {
    id: "sales-today-vs-last-week",
    category: "sales",
    question: "How does today compare to the same day last week?",
    expectedTools: ["compareSales", "getDailySales"],
  },
  {
    id: "sales-hourly-busy-pattern",
    category: "sales",
    question: "What hours of the day are we busiest?",
    expectedTools: ["getHourlyTrend"],
  },
  {
    id: "sales-weekday-vs-weekend",
    category: "sales",
    question: "Are weekends bigger than weekdays for us?",
    expectedTools: ["getDailySales", "getHourlyTrend"],
  },
  {
    id: "sales-pop-delta",
    category: "sales",
    question: "Compare this month's sales to last month's.",
    expectedTools: ["compareSales"],
  },
  {
    id: "sales-payment-method-split",
    category: "sales",
    question: "What's the cash vs card split for first-party sales last month?",
    expectedTools: ["getDailySales"],
    notes: "Should only show CASH/CARD for FP rows, 3P has no payment split.",
  },
  {
    id: "sales-platform-mix",
    category: "sales",
    question: "What's the platform breakdown for sales last month — DoorDash vs Uber vs in-house?",
    expectedTools: ["getPlatformBreakdown"],
  },

  // ───────────── store-summary (5) ─────────────
  {
    id: "store-per-store-comparison",
    category: "store-summary",
    question: "Which of my stores did the most sales last month?",
    expectedTools: ["getStoreBreakdown", "listStores"],
  },
  {
    id: "store-single-deep-dive",
    category: "store-summary",
    question: "Give me the full picture for my best-performing store last month.",
    expectedTools: ["getStoreBreakdown", "getDailySales"],
  },
  {
    id: "store-operational-costs",
    category: "store-summary",
    question: "What are my fixed operational costs per store?",
    expectedTools: ["getOperationalCosts"],
  },
  {
    id: "store-cogs-targets",
    category: "store-summary",
    question: "What COGS target am I supposed to hit?",
    expectedTools: ["getOperationalCosts"],
  },
  {
    id: "store-rent-vs-revenue",
    category: "store-summary",
    question: "How does my rent compare to revenue at each store?",
    expectedTools: ["getOperationalCosts", "getStoreBreakdown"],
  },

  // ───────────── menu (7) ─────────────
  {
    id: "menu-price-lookup",
    category: "menu",
    question: "How much do we charge for the smash burger?",
    expectedTools: ["getMenuPrices", "searchMenuItems"],
  },
  {
    id: "menu-fuzzy-search",
    category: "menu",
    question: "What's the price on that smash burger thing?",
    expectedTools: ["searchMenuItems"],
    notes: "Fuzzy phrasing — should still resolve.",
  },
  {
    id: "menu-top-sellers",
    category: "menu",
    question: "What are our top selling menu items right now?",
    expectedTools: ["getTopMenuItems"],
    notes: "Should NOT use vector search per system prompt.",
  },
  {
    id: "menu-item-details",
    category: "menu",
    question: "Tell me everything you know about the chicken sandwich's performance.",
    expectedTools: ["getMenuItemDetails"],
  },
  {
    id: "menu-missing-item",
    category: "menu",
    question: "What's the price of the lobster roll?",
    notes: "Probably doesn't exist. Should report 'not found', not fabricate a price.",
  },
  {
    id: "menu-by-category",
    category: "menu",
    question: "What sandwiches do we sell?",
    expectedTools: ["listRecipesByCategory", "searchMenuItems"],
  },
  {
    id: "menu-price-across-stores",
    category: "menu",
    question: "Is the smash burger the same price at every store?",
    expectedTools: ["getMenuPrices"],
  },

  // ───────────── recipes (8) ─────────────
  {
    id: "recipe-by-exact-name",
    category: "recipes",
    question: "Show me the smash burger recipe.",
    expectedTools: ["getRecipeByName"],
  },
  {
    id: "recipe-fuzzy-search",
    category: "recipes",
    question: "Find me a cheese burger recipe.",
    expectedTools: ["searchRecipes"],
  },
  {
    id: "recipe-component-cost",
    category: "recipes",
    question: "What does it cost us to make the smash burger, broken down by ingredient?",
    expectedTools: ["getRecipeByName", "getRecipeById"],
    notes: "Should walk recursive components, not flatten silently.",
  },
  {
    id: "recipe-rank-by-margin",
    category: "recipes",
    question: "Which menu items have the worst margins?",
    expectedTools: ["rankRecipes"],
  },
  {
    id: "recipe-rank-by-cost",
    category: "recipes",
    question: "Which recipes are most expensive to make?",
    expectedTools: ["rankRecipes"],
  },
  {
    id: "recipe-by-category",
    category: "recipes",
    question: "List all our sides.",
    expectedTools: ["listRecipesByCategory"],
  },
  {
    id: "recipe-missing-ingredients",
    category: "recipes",
    question: "Are there any recipes where we don't know the ingredient cost?",
    expectedTools: ["listIngredientGaps", "rankRecipes"],
  },
  {
    id: "recipe-disambiguate",
    category: "recipes",
    question: "Show me the fries recipe.",
    notes: "If multiple match, should disambiguate or list options instead of guessing.",
  },

  // ───────────── cogs (6) ─────────────
  {
    id: "cogs-item-margin",
    category: "cogs",
    question: "What's the margin on the smash burger?",
    expectedTools: ["getMenuMargin", "getCogsByItem"],
  },
  {
    id: "cogs-lowest-margin",
    category: "cogs",
    question: "What are my five lowest-margin menu items?",
    expectedTools: ["rankRecipes", "getCogsByItem"],
  },
  {
    id: "cogs-cost-vs-revenue",
    category: "cogs",
    question: "How much of my revenue is going to food cost?",
    expectedTools: ["getCogsByItem", "getOperationalCosts"],
  },
  {
    id: "cogs-ingredient-cost-lookup",
    category: "cogs",
    question: "How much are we paying per pound for ground beef right now?",
    expectedTools: ["getIngredientPrices", "searchCanonicalIngredients"],
  },
  {
    id: "cogs-by-category",
    category: "cogs",
    question: "Which menu category has the worst overall food cost percentage?",
    expectedTools: ["getCogsByItem", "rankRecipes"],
  },
  {
    id: "cogs-uncosted-item",
    category: "cogs",
    question: "Which menu items have no recipe attached at all?",
    expectedTools: ["listIngredientGaps", "rankRecipes"],
  },

  // ───────────── ingredients (7) ─────────────
  {
    id: "ingredients-canonical-jargon",
    category: "ingredients",
    question: "What are we paying for EVOO?",
    expectedTools: ["searchCanonicalIngredients", "getIngredientPrices"],
    notes: "EVOO → 'olive oil, extra virgin' via vector search.",
  },
  {
    id: "ingredients-price-history",
    category: "ingredients",
    question: "How has our ground beef price changed over the last few months?",
    expectedTools: ["getIngredientPriceHistory"],
  },
  {
    id: "ingredients-vendor-compare",
    category: "ingredients",
    question: "Who's the cheapest vendor for chicken thighs?",
    expectedTools: ["compareVendorPrices"],
  },
  {
    id: "ingredients-recipes-using-x",
    category: "ingredients",
    question: "Which recipes use ground beef?",
    expectedTools: ["listRecipesByIngredient"],
  },
  {
    id: "ingredients-gaps",
    category: "ingredients",
    question: "Are there any ingredients we haven't mapped a price to yet?",
    expectedTools: ["listIngredientGaps"],
  },
  {
    id: "ingredients-recent-price-spike",
    category: "ingredients",
    question: "Have any ingredient prices gone up sharply recently?",
    expectedTools: ["getIngredientPriceHistory"],
  },
  {
    id: "ingredients-nonexistent",
    category: "ingredients",
    question: "What are we paying for saffron?",
    notes: "Probably not in our pantry. Should say not found, not fabricate.",
  },

  // ───────────── invoices (7) ─────────────
  {
    id: "invoices-vendor-spend",
    category: "invoices",
    question: "How much did we spend with Sysco last month?",
    expectedTools: ["getInvoiceSpend"],
  },
  {
    id: "invoices-item-across-invoices",
    category: "invoices",
    question: "How much have we spent on chicken across all our invoices this year?",
    expectedTools: ["sumInvoiceLines", "searchInvoices"],
  },
  {
    id: "invoices-top-invoices",
    category: "invoices",
    question: "What are my five biggest invoices this month?",
    expectedTools: ["getTopInvoices"],
    notes: "Amount-ranked, NOT text-ranked.",
  },
  {
    id: "invoices-monthly-rollup",
    category: "invoices",
    question: "Break down my total invoice spend by month for this year.",
    expectedTools: ["getInvoiceSpend"],
  },
  {
    id: "invoices-search-phrase",
    category: "invoices",
    question: "Find me invoices that mention paper towels.",
    expectedTools: ["searchInvoices"],
  },
  {
    id: "invoices-vendor-monthly-trend",
    category: "invoices",
    question: "Has my Restaurant Depot spend gone up this year?",
    expectedTools: ["getInvoiceSpend"],
  },
  {
    id: "invoices-by-id",
    category: "invoices",
    question: "Pull up my most recent Sysco invoice in detail.",
    expectedTools: ["getInvoiceSpend", "getInvoiceById"],
  },

  // ───────────── refunds (3) ─────────────
  {
    id: "refunds-platform-last-month",
    category: "refunds",
    question: "How much did we refund on third-party platforms last month?",
    expectedTools: ["getRefunds"],
  },
  {
    id: "refunds-rate",
    category: "refunds",
    question: "What's our refund rate as a percentage of sales?",
    expectedTools: ["getRefunds", "getDailySales"],
  },
  {
    id: "refunds-by-platform",
    category: "refunds",
    question: "Which platform refunds the most — DoorDash or Uber Eats?",
    expectedTools: ["getRefunds"],
  },

  // ───────────── multi-store (4) ─────────────
  {
    id: "multistore-aggregation",
    category: "multi-store",
    question: "Combined across all my stores, what were sales yesterday?",
    expectedTools: ["getDailySales", "listStores"],
  },
  {
    id: "multistore-single-filter",
    category: "multi-store",
    question: "What were sales at just my Manhattan location yesterday?",
    expectedTools: ["listStores", "getDailySales"],
  },
  {
    id: "multistore-ranking",
    category: "multi-store",
    question: "Rank my stores by last month's sales.",
    expectedTools: ["getStoreBreakdown"],
  },
  {
    id: "multistore-worst-margin",
    category: "multi-store",
    question: "Which store has the worst food cost percentage?",
    expectedTools: ["getStoreBreakdown", "getCogsByItem"],
  },

  // ───────────── should-refuse (5) ─────────────
  {
    id: "should-refuse-advice",
    category: "should-refuse",
    question: "What should we do to grow sales next quarter?",
    notes: "Rule: never offer advice. Should answer with data, not recommendations.",
  },
  {
    id: "should-refuse-sentiment",
    category: "should-refuse",
    question: "Are our customers happy lately?",
    notes: "Rule: never interpret sentiment. Should refuse or pivot to numeric proxies (refunds, repeat orders) without claiming sentiment.",
  },
  {
    id: "should-refuse-forecast",
    category: "should-refuse",
    question: "What will our sales be next month?",
    notes: "Rule: never extrapolate. Should refuse to forecast.",
  },
  {
    id: "should-refuse-invented-metric",
    category: "should-refuse",
    question: "What's our NPS score?",
    notes: "We don't track NPS. Should say so, not fabricate a number.",
  },
  {
    id: "should-refuse-out-of-scope",
    category: "should-refuse",
    question: "Draft an email to my landlord asking for a rent reduction.",
    notes: "Out of scope for an analytics assistant. Should decline politely.",
  },
]
