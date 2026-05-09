import { listStores } from "./list-stores"
import { compareSales, getDailySales, getHourlyTrend } from "./sales"
import { getPlatformBreakdown } from "./platforms"
import { getCogsByItem } from "./cogs"
import {
  getMenuItemDetails,
  getMenuPrices,
  getTopMenuItems,
  searchMenuItems,
} from "./menu"
import {
  compareVendorPrices,
  getIngredientPrice,
  getIngredientPriceHistory,
  getIngredientPrices,
  listIngredientGaps,
  listRecipesByIngredient,
  searchCanonicalIngredients,
} from "./ingredients"
import {
  getInvoiceById,
  getInvoiceSpend,
  getTopInvoices,
  searchInvoices,
  sumInvoiceLines,
} from "./invoices"
import {
  getMenuMargin,
  getRecipeById,
  getRecipeByName,
  listRecipesByCategory,
  rankRecipes,
  searchRecipes,
} from "./recipes"
import { getOperationalCosts, getStoreBreakdown } from "./store-summary"
import { getRefunds } from "./refunds"
import { getPnlSummary } from "./pnl"
import { searchPnlHistory } from "./pnl-history"
import {
  getCashPositionForecastTool,
  getChannelMixTool,
  getFoodCostForecastTool,
  getLaborStaffingForecastTool,
  getLaunchTrajectoryTool,
  getLostSalesTool,
  getMenuEngineeringTool,
  getMenuItemForecast,
  getOpenAnomalies,
  getPromoRoiTool,
  getRevenueForecast,
  getVendorReliabilityTool,
  getWasteRootCausesTool,
} from "./forecasts"
import {
  getInventoryStatus,
  getInventoryCoverage,
  listStockCountsTool,
  getRecentInventoryAdjustments,
} from "./inventory"
import {
  getOrderById,
  listOrdersByDay,
  getOrderItemFrequency,
} from "./orders"
import { listVendorLeadTimes } from "./vendors"
import { getMenuItemElasticity, simulatePriceChange } from "./elasticity"
import { describeSchema } from "./describe-schema"

export type { ChatTool, ChatToolContext } from "./types"

/**
 * The complete chat tool surface. Every tool is owner-scoped via its own
 * resolveStoreIds / assertOwnerOwnsStores call — the route handler must
 * pass the authenticated owner's id in `ctx.ownerId`, never trust a value
 * from the model.
 */
export const chatTools = {
  // Meta
  listStores,
  describeSchema,
  // Sales
  getDailySales,
  getHourlyTrend,
  compareSales,
  // Platforms / per-store
  getPlatformBreakdown,
  getStoreBreakdown,
  getOperationalCosts,
  // Menu
  getMenuPrices,
  searchMenuItems,
  getMenuItemDetails,
  getTopMenuItems,
  // COGS / ingredients
  getCogsByItem,
  getIngredientPrices,
  searchCanonicalIngredients,
  getIngredientPrice,
  getIngredientPriceHistory,
  compareVendorPrices,
  listRecipesByIngredient,
  listIngredientGaps,
  // Invoices
  searchInvoices,
  sumInvoiceLines,
  getTopInvoices,
  getInvoiceSpend,
  getInvoiceById,
  // Recipes
  searchRecipes,
  getRecipeByName,
  getRecipeById,
  getMenuMargin,
  rankRecipes,
  listRecipesByCategory,
  // Refunds
  getRefunds,
  // P&L
  getPnlSummary,
  searchPnlHistory,
  // ML forecasts + anomalies
  getRevenueForecast,
  getMenuItemForecast,
  getOpenAnomalies,
  getFoodCostForecast: getFoodCostForecastTool,
  getLaborStaffingForecast: getLaborStaffingForecastTool,
  getMenuEngineering: getMenuEngineeringTool,
  getLostSales: getLostSalesTool,
  getCashPositionForecast: getCashPositionForecastTool,
  getVendorReliability: getVendorReliabilityTool,
  getPromoRoi: getPromoRoiTool,
  getLaunchTrajectory: getLaunchTrajectoryTool,
  getChannelMix: getChannelMixTool,
  getWasteRootCauses: getWasteRootCausesTool,
  // Inventory
  getInventoryStatus,
  getInventoryCoverage,
  listStockCounts: listStockCountsTool,
  getRecentInventoryAdjustments,
  // Orders (drilldown)
  getOrderById,
  listOrdersByDay,
  getOrderItemFrequency,
  // Vendors
  listVendorLeadTimes,
  // Elasticity (price what-ifs)
  getMenuItemElasticity,
  simulatePriceChange,
} as const

export type ChatToolName = keyof typeof chatTools
