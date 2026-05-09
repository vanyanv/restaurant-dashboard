// Phase 2 — Grounding: a meta-tool the model can call to self-discover what
// chat tools and data domains exist. Avoids the "I don't have access to that"
// false-negative when the system prompt happens to omit a tool.
//
// The catalog is hand-curated (rather than introspected from `chatTools`)
// because the model needs domain context, not just tool names — knowing
// `getCashPositionForecast` exists is useless without knowing it answers
// 14-day cash-flow questions and reads from the revenue-forecast pipeline.

import { z } from "zod"
import type { ChatTool } from "./types"

const params = z
  .object({
    domain: z
      .enum([
        "all",
        "stores",
        "sales",
        "orders",
        "menu",
        "recipes",
        "ingredients",
        "invoices",
        "cogs",
        "pnl",
        "inventory",
        "vendors",
        "forecasts",
        "anomalies",
        "elasticity",
      ])
      .optional()
      .default("all")
      .describe("Restrict the catalog to one domain. 'all' returns everything."),
  })
  .strict()

export type SchemaDomain = {
  domain: string
  summary: string
  tools: { name: string; useFor: string }[]
  notes?: string
}

const CATALOG: SchemaDomain[] = [
  {
    domain: "stores",
    summary: "Owner-scoped store directory. Always call listStores first to resolve names → ids.",
    tools: [{ name: "listStores", useFor: "name → id resolution; multi-store rollups" }],
  },
  {
    domain: "sales",
    summary: "Aggregated revenue from Otter daily/hourly summaries. Sums first-party + third-party.",
    tools: [
      { name: "getDailySales", useFor: "gross/net/fees/tax/tips/count by day, platform, or paymentMethod" },
      { name: "getHourlyTrend", useFor: "intraday trend by hour-of-day" },
      { name: "compareSales", useFor: "two-period A/B comparisons" },
      { name: "getPlatformBreakdown", useFor: "per-platform totals (DoorDash / UberEats / first-party)" },
      { name: "getStoreBreakdown", useFor: "side-by-side per-store totals" },
      { name: "getOperationalCosts", useFor: "fees, refunds, discounts, lost revenue per store" },
    ],
  },
  {
    domain: "orders",
    summary: "Order-level drilldown. Use sales tools for trend questions; orders tools for ticket-level questions.",
    tools: [
      { name: "getOrderById", useFor: "full detail for one order (line items, modifiers, totals)" },
      { name: "listOrdersByDay", useFor: "biggest tickets / orders over $X / orders by platform in a window" },
      { name: "getOrderItemFrequency", useFor: "how many distinct orders contained each item; basket-level signal" },
    ],
  },
  {
    domain: "menu",
    summary: "Menu items as Otter sees them — names, prices, categories.",
    tools: [
      { name: "getMenuPrices", useFor: "current sell prices" },
      { name: "searchMenuItems", useFor: "fuzzy text → menu item lookup (vector)" },
      { name: "getMenuItemDetails", useFor: "details for one item including category and history" },
      { name: "getTopMenuItems", useFor: "best-selling items by qty or revenue" },
    ],
  },
  {
    domain: "recipes",
    summary: "Owner-built recipes that map menu items to canonical ingredients with portions.",
    tools: [
      { name: "searchRecipes", useFor: "fuzzy text → recipe lookup (vector)" },
      { name: "getRecipeByName", useFor: "exact-name lookup" },
      { name: "getRecipeById", useFor: "lookup by id" },
      { name: "getMenuMargin", useFor: "per-item margin (price − recipe cost)" },
      { name: "rankRecipes", useFor: "top/bottom by margin or cost" },
      { name: "listRecipesByCategory", useFor: "browse by menu category" },
    ],
  },
  {
    domain: "ingredients",
    summary: "Canonical ingredient catalog (deduped across vendor SKUs).",
    tools: [
      { name: "getIngredientPrices", useFor: "current $/recipe-unit per ingredient" },
      { name: "searchCanonicalIngredients", useFor: "fuzzy text → canonical ingredient (vector)" },
      { name: "getIngredientPrice", useFor: "single ingredient current price" },
      { name: "getIngredientPriceHistory", useFor: "price-over-time (vendor switches, inflation)" },
      { name: "compareVendorPrices", useFor: "same ingredient across vendors" },
      { name: "listRecipesByIngredient", useFor: "which dishes use ingredient X" },
      { name: "listIngredientGaps", useFor: "ingredients used in recipes but missing canonical mapping" },
    ],
  },
  {
    domain: "invoices",
    summary: "Email-synced vendor invoices with line items.",
    tools: [
      { name: "searchInvoices", useFor: "fuzzy text → invoice line items (vector)" },
      { name: "sumInvoiceLines", useFor: "sum spend matching a search across a window" },
      { name: "getTopInvoices", useFor: "biggest invoices in a window" },
      { name: "getInvoiceSpend", useFor: "total spend by vendor / store / period" },
      { name: "getInvoiceById", useFor: "one invoice with all line items" },
    ],
  },
  {
    domain: "cogs",
    summary: "Daily costed-cogs rollup per menu item (uses recipe cost × sold qty).",
    tools: [{ name: "getCogsByItem", useFor: "per-item food cost over a window" }],
  },
  {
    domain: "pnl",
    summary: "Period P&L (revenue − COGS − labor − fixed). Live numbers come from getPnlSummary; historical narrative search from searchPnlHistory.",
    tools: [
      { name: "getPnlSummary", useFor: "current-period P&L by store and total" },
      { name: "searchPnlHistory", useFor: "vector search over weekly P&L narratives — 'when was margin last this bad?'" },
    ],
  },
  {
    domain: "inventory",
    summary: "Physical inventory (on-hand, reorder status, counts, adjustments).",
    tools: [
      { name: "getInventoryStatus", useFor: "per-ingredient on-hand, days-of-cover, reorder status, lead time" },
      { name: "getInventoryCoverage", useFor: "what fraction of last-7d sales is mapped to costed recipes (caveat for food-cost answers)" },
      { name: "listStockCounts", useFor: "recent physical counts (status, when, line count)" },
      { name: "getRecentInventoryAdjustments", useFor: "logged theft / expiry / supplier-return / damage events" },
    ],
  },
  {
    domain: "vendors",
    summary: "Vendor lead times and reliability signals.",
    tools: [
      { name: "listVendorLeadTimes", useFor: "median delivery lead-days per vendor (raw cache)" },
      { name: "getVendorReliability", useFor: "composite 0-100 reliability score per vendor with lead-CV, price-volatility, monthly-CV" },
    ],
  },
  {
    domain: "forecasts",
    summary: "Forward-looking ML predictions from the nightly XGBoost pipeline. Read-only — chat never trains.",
    tools: [
      { name: "getRevenueForecast", useFor: "14-day daily revenue with p10/p50/p90 prediction intervals" },
      { name: "getMenuItemForecast", useFor: "per-item demand for the next 7-14 days" },
      { name: "getFoodCostForecast", useFor: "blended food cost % over the next 7-14 days (revenue × demand × recipe cost)" },
      { name: "getLaborStaffingForecast", useFor: "recommended staff per hour next 7-14 days (budgeted, NOT actuals)" },
      { name: "getCashPositionForecast", useFor: "14-day delta cash flow (inflow − payables − fixed). Returns delta, not absolute balance" },
      { name: "getLostSales", useFor: "86'd-item windows with estimated lost revenue" },
      { name: "getMenuEngineering", useFor: "Star/Plowhorse/Puzzle/Dog quadrant classifier" },
      { name: "getPromoRoi", useFor: "inferred-promo days with lift vs same-weekday baseline" },
      { name: "getLaunchTrajectory", useFor: "newly-launched menu items + 90-day projection (linear, no ramp)" },
      { name: "getChannelMix", useFor: "per-platform net-rate + shift simulation (X% migration what-if)" },
    ],
  },
  {
    domain: "anomalies",
    summary: "Z-score deviation events and waste root-cause clustering.",
    tools: [
      { name: "getOpenAnomalies", useFor: "open z-score events (revenue, menu-item, ingredient, labor, refunds)" },
      { name: "getWasteRootCauses", useFor: "(store, ingredient) waste-residual cluster labels (theft_or_unrecorded, expiry_driven, etc.)" },
    ],
  },
  {
    domain: "elasticity",
    summary: "Price elasticity per menu item — fitted nightly. Use to answer 'what if I raised the price?'.",
    tools: [
      { name: "getMenuItemElasticity", useFor: "list fitted curves per item with confidence (R², sample size, price-point count)" },
      { name: "simulatePriceChange", useFor: "what-if: predicted daily qty + revenue at a hypothetical new price" },
    ],
    notes: "Linear fit. Extrapolating beyond ±25% of meanPrice is directional only.",
  },
]

export const describeSchema: ChatTool<
  typeof params,
  { domains: SchemaDomain[]; totalToolCount: number }
> = {
  name: "describeSchema",
  description:
    "Meta-tool: returns the catalog of data domains and tools available in this chat. Call when the user asks 'what can you do?', 'what data do you have?', or 'how do you know X?' — or when you're unsure whether a tool exists for a question. Domains: stores, sales, orders, menu, recipes, ingredients, invoices, cogs, pnl, inventory, vendors, forecasts, anomalies, elasticity.",
  parameters: params,
  async execute(args, ctx) {
    void ctx
    const domains =
      args.domain === "all" || !args.domain
        ? CATALOG
        : CATALOG.filter((d) => d.domain === args.domain)
    const totalToolCount = CATALOG.reduce((acc, d) => acc + d.tools.length, 0)
    return { domains, totalToolCount }
  },
}
