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
import { getIngredientPrices } from "./ingredients"
import {
  getInvoiceById,
  getInvoiceSpend,
  getTopInvoices,
  searchInvoices,
  sumInvoiceLines,
} from "./invoices"
import { getRecipeById, getRecipeByName, searchRecipes } from "./recipes"
import { getOperationalCosts, getStoreBreakdown } from "./store-summary"
import { getRefunds } from "./refunds"

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
  // Refunds
  getRefunds,
} as const

export type ChatToolName = keyof typeof chatTools
