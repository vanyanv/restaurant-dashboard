import type { ChatToolName } from "./tools"

/**
 * Which tools a question can reach, decided by the page it was asked from.
 *
 * ## Why this exists
 *
 * Every turn used to carry all 58 tool schemas — measured at 21.9k input
 * tokens before the model had read the question — and `CHAT_ROUTING_MODEL` is
 * a reasoning model, so it planned across that whole menu on every question.
 * That is the largest single contributor to the 15–19s turn.
 *
 * The context sentence above the composer already knows the reader is looking
 * at P&L. It was prepended to the question as PROSE and nothing acted on it.
 * This module is the other half: the same context, read as a key, deciding
 * which schemas are worth sending.
 *
 * ## What this is not
 *
 * It is not a permission boundary. `chatTools` is still handed to `streamText`
 * whole, so every tool keeps its schema, its owner-scope wrapper and its
 * `execute`; `activeTools` only narrows what is OFFERED for a given turn.
 * Auth lives in the tools, exactly where it did.
 *
 * A page whose id is not in `NAV_TOOL_GROUPS` resolves to `null`, and `null`
 * means "send everything" — the behaviour before this file existed. Every
 * failure mode here degrades to slow, never to wrong.
 */

/** The three that belong to every turn regardless of subject. */
const ALWAYS: readonly ChatToolName[] = [
  // How the answer becomes UI. A turn that cannot file its return renders
  // as loose prose, so this is never narrowed away.
  "fileReturn",
  // Cheap meta the model uses to resolve "which store" and "what exists"
  // before committing to a domain call.
  "listStores",
  "describeSchema",
]

/**
 * Domain groups, named for the department a reader would say they were in.
 *
 * A tool may appear in more than one group on purpose: `getCogsByItem` is a
 * COGS question on the COGS page and a recipe question on Recipes, and the
 * cost of listing it twice is one schema in one turn.
 */
export const TOOL_GROUPS = {
  sales: [
    "getDailySales",
    "getHourlyTrend",
    "compareSales",
    "getPlatformBreakdown",
    "getStoreBreakdown",
    "getChannelMix",
    "getRefunds",
  ],
  pnl: [
    "getPnlSummary",
    "searchPnlHistory",
    "getOperationalCosts",
    "getFoodCostForecast",
    "getCashPositionForecast",
  ],
  costs: [
    "getCogsByItem",
    "getIngredientPrices",
    "searchCanonicalIngredients",
    "getIngredientPrice",
    "getIngredientPriceHistory",
    "compareVendorPrices",
    "listRecipesByIngredient",
    "listIngredientGaps",
  ],
  invoices: [
    "searchInvoices",
    "sumInvoiceLines",
    "getTopInvoices",
    "getInvoiceSpend",
    "getInvoiceById",
  ],
  menu: [
    "getMenuPrices",
    "searchMenuItems",
    "getMenuItemDetails",
    "getTopMenuItems",
    "getMenuMargin",
    "getMenuEngineering",
  ],
  recipes: [
    "searchRecipes",
    "getRecipeByName",
    "getRecipeById",
    "rankRecipes",
    "listRecipesByCategory",
    "getMenuMargin",
    "getCogsByItem",
  ],
  elasticity: ["getMenuItemElasticity", "simulatePriceChange"],
  inventory: [
    "getInventoryStatus",
    "getInventoryCoverage",
    "listStockCounts",
    "getRecentInventoryAdjustments",
    "getWasteRootCauses",
  ],
  vendors: ["listVendorLeadTimes", "getVendorReliability", "compareVendorPrices"],
  orders: ["getOrderById", "listOrdersByDay", "getOrderItemFrequency"],
  labor: ["getLaborStaffingForecast", "getOperationalCosts"],
  anomalies: ["getOpenAnomalies", "getLostSales"],
  /**
   * The 13 ML tools. Deliberately NOT unioned into every page: a question
   * about last week does not need the forecast menu, and this group is the
   * single largest. Phase 4 ("prediction, unprompted") is what routes a
   * forward-looking question here without the reader naming a tool.
   */
  forecasts: [
    "getRevenueForecast",
    "getMenuItemForecast",
    "getFoodCostForecast",
    "getLaborStaffingForecast",
    "getCashPositionForecast",
    "getLostSales",
    "getPromoRoi",
    "getLaunchTrajectory",
    "getChannelMix",
    "getMenuEngineering",
    "getVendorReliability",
    "getWasteRootCauses",
  ],
} as const satisfies Record<string, readonly ChatToolName[]>

export type ToolGroupName = keyof typeof TOOL_GROUPS

/**
 * Nav id → the groups that page's questions actually reach.
 *
 * Unions rather than single groups, because the questions a reader asks on a
 * page cross departments the moment they are interesting: "is DoorDash eating
 * my margin?" is asked on Analytics and needs platform sales AND recipes.
 * That is risk #1 in the proposal, and a union is the mitigation.
 *
 * Keys are `NavId` values from `src/lib/counter/nav.ts`. They are ids, not
 * labels, so renaming "P&L" in the rail does not silently unroute it.
 */
export const NAV_TOOL_GROUPS: Record<string, readonly ToolGroupName[]> = {
  overview: ["sales", "anomalies", "pnl"],
  analytics: ["sales", "orders", "menu"],
  pnl: ["pnl", "costs", "invoices"],
  cogs: ["costs", "recipes", "invoices"],
  labor: ["labor", "pnl"],
  menu: ["menu", "recipes", "elasticity"],
  recipes: ["recipes", "costs", "menu"],
  invoices: ["invoices", "costs", "vendors"],
  inventory: ["inventory", "costs", "vendors"],
  ingredients: ["costs", "vendors", "inventory"],
  vendors: ["vendors", "invoices", "costs"],
  orders: ["orders", "sales"],
  "needs-you": ["anomalies", "sales", "forecasts"],
  stores: ["sales", "pnl"],
}

/**
 * One line per group, for the classifier's prompt.
 *
 * Measured need, not decoration: given bare names the nano model has to guess
 * what "sales" or "costs" contains, and it guessed wrong on exactly the
 * question the proposal names as risk #1 — "is DoorDash eating my margin?"
 * routed to pnl+costs, leaving `getPlatformBreakdown` (in `sales`) out of the
 * turn. These lines name the figures each group can actually reach, so the
 * choice is a lookup rather than an inference about our vocabulary.
 */
export const GROUP_HINTS: Record<ToolGroupName, string> = {
  sales: "net sales by day/hour, per delivery platform (DoorDash, UberEats, Grubhub) or per store, channel mix, refunds",
  pnl: "the P&L itself — revenue vs plan, food cost %, prime cost, operating costs, cash position",
  costs: "COGS and ingredient prices — what an ingredient costs, price history, vendor price comparison",
  invoices: "supplier invoices and spend — what we bought, from whom, for how much",
  menu: "menu items and their prices, best sellers, item margin, menu engineering",
  recipes: "recipes and what a plate is made of, recipe cost, margin ranking by recipe",
  elasticity: "price what-ifs — what happens to demand and profit if a price changes",
  inventory: "on-hand stock, counts, coverage, waste and shrink",
  vendors: "vendor reliability and delivery lead times",
  orders: "individual orders and order-level drilldown",
  labor: "staffing and labour cost",
  anomalies: "open alerts, things that need attention, lost sales",
  forecasts: "anything FORWARD-LOOKING — what will happen next week/Saturday, predicted revenue, demand, promos",
}

/** Every tool name in every group, deduped — used to assert the map is total. */
export function toolsInGroups(groups: readonly ToolGroupName[]): ChatToolName[] {
  const seen = new Set<ChatToolName>(ALWAYS)
  for (const g of groups) for (const t of TOOL_GROUPS[g]) seen.add(t)
  return [...seen]
}

/**
 * The active set for a turn, or `null` for "all of them".
 *
 * `null` is returned for a page with no mapping (Settings, Monitoring), and
 * for Ask itself when the reader arrived with no subject — those are the cases
 * the classifier exists to answer, and until it does, the honest answer is the
 * full menu rather than a guessed department.
 */
export function activeToolsForPage(pageId: string | null): ChatToolName[] | null {
  if (!pageId) return null
  const groups = NAV_TOOL_GROUPS[pageId]
  if (!groups || groups.length === 0) return null
  return toolsInGroups(groups)
}
