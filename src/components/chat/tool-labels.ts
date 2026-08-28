/** Plain-English verb phrases for each tool. Used by the thinking
 * indicator so the owner sees "Searching invoices…" instead of the raw
 * tool name. Keep these short, lowercase, ledger-voice.
 *
 * Three forms:
 * - `running`: shown live with an ellipsis ("Reading invoices…")
 * - `done`: shown when listing the single tool used ("Read invoices")
 * - `short`: noun-only fragment used when joining multiple tools into
 *   a "Read · invoices · sales" line — keeps the prefix from repeating. */
export const TOOL_LABELS: Record<
  string,
  { running: string; done: string; short: string }
> = {
  /*
   * Everything below was unlabelled until 2026-08-27, when Ask began
   * printing its "Read" row on three Counter surfaces and the row came
   * out as `GETPNLSUMMARY` and `GETINVENTORYCOVERAGE`. Ruling K-R2 makes
   * that row the product's whole argument — an answer names what it read
   * — so a raw camelCase identifier there names nothing to an owner.
   * 36 of the 58 registered tools were missing; these are they.
   */
  getPnlSummary: {
    running: "Pulling the P&L",
    done: "Read the P&L",
    short: "P&L",
  },
  searchPnlHistory: {
    running: "Searching past P&L weeks",
    done: "Searched P&L history",
    short: "P&L history",
  },
  getMenuMargin: {
    running: "Working out menu margin",
    done: "Read menu margin",
    short: "menu margin",
  },
  getMenuEngineering: {
    running: "Reading the menu matrix",
    done: "Read menu engineering",
    short: "menu matrix",
  },
  rankRecipes: {
    running: "Ranking recipes",
    done: "Ranked recipes",
    short: "recipe ranking",
  },
  listRecipesByCategory: {
    running: "Listing recipes by category",
    done: "Listed recipes",
    short: "recipes",
  },
  listRecipesByIngredient: {
    running: "Finding recipes using it",
    done: "Found recipes",
    short: "recipes",
  },
  simulatePriceChange: {
    running: "Modelling the price change",
    done: "Modelled a price change",
    short: "price change",
  },
  getMenuItemElasticity: {
    running: "Reading price sensitivity",
    done: "Read elasticity",
    short: "elasticity",
  },
  getRevenueForecast: {
    running: "Reading the revenue forecast",
    done: "Read the revenue forecast",
    short: "revenue forecast",
  },
  getMenuItemForecast: {
    running: "Reading the item forecast",
    done: "Read the item forecast",
    short: "item forecast",
  },
  getFoodCostForecast: {
    running: "Reading the food-cost forecast",
    done: "Read the food-cost forecast",
    short: "food-cost forecast",
  },
  getLaborStaffingForecast: {
    running: "Reading the staffing forecast",
    done: "Read the staffing forecast",
    short: "staffing forecast",
  },
  getCashPositionForecast: {
    running: "Projecting cash position",
    done: "Read the cash forecast",
    short: "cash forecast",
  },
  getOpenAnomalies: {
    running: "Checking open anomalies",
    done: "Read open anomalies",
    short: "anomalies",
  },
  getLostSales: {
    running: "Reading lost sales",
    done: "Read lost sales",
    short: "lost sales",
  },
  getPromoRoi: {
    running: "Reading promo returns",
    done: "Read promo ROI",
    short: "promo ROI",
  },
  getLaunchTrajectory: {
    running: "Reading the launch curve",
    done: "Read the launch trajectory",
    short: "launch trajectory",
  },
  getChannelMix: {
    running: "Splitting the channel mix",
    done: "Read the channel mix",
    short: "channel mix",
  },
  getWasteRootCauses: {
    running: "Tracing waste causes",
    done: "Read waste causes",
    short: "waste causes",
  },
  getVendorReliability: {
    running: "Checking vendor reliability",
    done: "Read vendor reliability",
    short: "vendor reliability",
  },
  compareVendorPrices: {
    running: "Comparing vendor prices",
    done: "Compared vendor prices",
    short: "vendor prices",
  },
  listVendorLeadTimes: {
    running: "Reading vendor lead times",
    done: "Read lead times",
    short: "lead times",
  },
  getIngredientPrice: {
    running: "Reading the ingredient price",
    done: "Read the ingredient price",
    short: "ingredient price",
  },
  getIngredientPriceHistory: {
    running: "Tracing the price history",
    done: "Read price history",
    short: "price history",
  },
  searchCanonicalIngredients: {
    running: "Searching ingredients",
    done: "Searched ingredients",
    short: "ingredients",
  },
  listIngredientGaps: {
    running: "Finding unmatched ingredients",
    done: "Read ingredient gaps",
    short: "ingredient gaps",
  },
  getInventoryStatus: {
    running: "Reading inventory",
    done: "Read inventory",
    short: "inventory",
  },
  getInventoryCoverage: {
    running: "Working out days of cover",
    done: "Read inventory coverage",
    short: "inventory cover",
  },
  listStockCounts: {
    running: "Listing stock counts",
    done: "Read stock counts",
    short: "stock counts",
  },
  getRecentInventoryAdjustments: {
    running: "Reading stock adjustments",
    done: "Read adjustments",
    short: "adjustments",
  },
  getOrderById: {
    running: "Opening the order",
    done: "Read the order",
    short: "an order",
  },
  listOrdersByDay: {
    running: "Listing orders",
    done: "Read orders",
    short: "orders",
  },
  getOrderItemFrequency: {
    running: "Counting item frequency",
    done: "Read item frequency",
    short: "item frequency",
  },
  describeSchema: {
    running: "Checking what is recorded",
    done: "Checked the schema",
    short: "the schema",
  },
  fileReturn: {
    running: "Filing the answer",
    done: "Filed the answer",
    short: "the answer",
  },
  listStores: {
    running: "Reading store list",
    done: "Resolved stores",
    short: "stores",
  },
  getDailySales: {
    running: "Pulling sales totals",
    done: "Read sales totals",
    short: "sales",
  },
  getHourlyTrend: {
    running: "Reading the hourly trend",
    done: "Read hourly trend",
    short: "hourly trend",
  },
  getPlatformBreakdown: {
    running: "Splitting sales by platform",
    done: "Read platform breakdown",
    short: "platform split",
  },
  getCogsByItem: {
    running: "Reading item-level COGS",
    done: "Read item COGS",
    short: "item COGS",
  },
  getMenuPrices: {
    running: "Looking up menu prices",
    done: "Read menu prices",
    short: "menu prices",
  },
  searchMenuItems: {
    running: "Searching the menu",
    done: "Searched the menu",
    short: "menu",
  },
  getIngredientPrices: {
    running: "Looking up ingredient cost",
    done: "Read ingredient cost",
    short: "ingredient cost",
  },
  searchInvoices: {
    running: "Searching invoices",
    done: "Searched invoices",
    short: "invoices",
  },
  sumInvoiceLines: {
    running: "Totalling invoice lines",
    done: "Totalled invoice lines",
    short: "invoice lines",
  },
  getTopInvoices: {
    running: "Ranking invoices by amount",
    done: "Read top invoices",
    short: "top invoices",
  },
  getInvoiceSpend: {
    running: "Reading total invoice spend",
    done: "Read invoice spend",
    short: "invoice spend",
  },
  getInvoiceById: {
    running: "Pulling the invoice",
    done: "Read invoice",
    short: "invoice",
  },
  searchRecipes: {
    running: "Searching recipes",
    done: "Searched recipes",
    short: "recipes",
  },
  getRecipeByName: {
    running: "Pulling the recipe",
    done: "Read recipe",
    short: "recipe",
  },
  getRecipeById: {
    running: "Pulling the recipe",
    done: "Read recipe",
    short: "recipe",
  },
  getMenuItemDetails: {
    running: "Reading the menu item",
    done: "Read menu item",
    short: "menu item",
  },
  getTopMenuItems: {
    running: "Ranking menu items",
    done: "Read top menu items",
    short: "top menu items",
  },
  getStoreBreakdown: {
    running: "Splitting sales by store",
    done: "Read per-store summary",
    short: "per-store",
  },
  getOperationalCosts: {
    running: "Reading fixed costs",
    done: "Read fixed costs",
    short: "fixed costs",
  },
  getRefunds: {
    running: "Reading refunds",
    done: "Read refunds",
    short: "refunds",
  },
  compareSales: {
    running: "Comparing periods",
    done: "Compared periods",
    short: "period comparison",
  },
}

export function labelFor(
  toolName: string,
): { running: string; done: string; short: string } {
  return (
    TOOL_LABELS[toolName] ?? {
      running: `Running ${toolName}`,
      done: `Used ${toolName}`,
      short: toolName,
    }
  )
}
