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
} as const

export type ChatToolName = keyof typeof chatTools
