// Re-export shim — see docs/refactor-playbook.md.
// IMPORTANT: do NOT add `"use server"` here — Next.js erases re-exports from
// `"use server"` modules and produces "module has no exports at all" at build.

export {
  createStore,
  getStores,
  getStoreById,
  updateStore,
  deleteStore,
} from "./store/crud-actions"

export {
  getOtterAnalytics,
  getRevenueTrendData,
  getDashboardAnalytics,
} from "./store/dashboard-analytics-actions"

export {
  getMenuCategoryAnalytics,
  getProductMixData,
} from "./store/menu-analytics-actions"

export { getOrderPatterns } from "./store/order-patterns-actions"

export {
  getStorePnL,
  getAllStoresPnL,
  recomputeCogsForStore,
} from "./store/pnl-actions"

export {
  createStoreFixedExpense,
  updateStoreFixedExpense,
  deleteStoreFixedExpense,
} from "./store/fixed-expense-actions"

export type { StoreFixedExpenseDTO } from "./store/fixed-expense-actions"

export type {
  PnLMover,
  StorePnLResult,
  AllStoresPnLResult,
} from "./store/pnl-types"
