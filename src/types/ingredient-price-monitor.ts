export type IngredientPriceIssueStatus =
  | "ok"
  | "locked"
  | "stale"
  | "no-recipe-unit"
  | "conversion-issue"
  | "unpriced"

export type IngredientPriceMonitorFilters = {
  days?: number
  storeId?: string
  category?: string
  status?: string
}

export type IngredientPriceMonitorKpis = {
  matchedLineItems: number
  recentLineItems: number
  matchedPct: number
  updatedIngredients: number
  lockedIngredients: number
  staleCosts: number
  conversionIssues: number
}

export type IngredientPriceMonitorPoint = {
  normalizedUnitPrice: number | null
  normalizedUnit: string | null
  rawUnitPrice: number
  rawUnit: string | null
  vendor: string
  sku: string | null
  invoiceId: string
  invoiceNumber: string
  date: string
}

export type IngredientPriceMonitorReceipt = IngredientPriceMonitorPoint & {
  productName: string
  quantity: number
  extendedPrice: number
}

export type IngredientPriceMonitorMenuImpact = {
  recipeId: string
  recipeName: string
  category: string
  quantity: number
  unit: string
  lineCost: number | null
  missingCost: boolean
}

export type IngredientPriceMonitorRow = {
  canonicalIngredientId: string
  name: string
  category: string | null
  recipeUnit: string | null
  currentNormalizedCost: number | null
  currentUnit: string | null
  source: "manual" | "invoice" | null
  costLocked: boolean
  latestInvoiceVendor: string | null
  latestInvoiceSku: string | null
  latestInvoiceDate: string | null
  latestInvoiceId: string | null
  latestInvoiceNumber: string | null
  latestInvoiceNormalizedCost: number | null
  latestInvoiceRawUnitPrice: number | null
  latestInvoiceRawUnit: string | null
  change30dPct: number | null
  recipeUsageCount: number
  status: IngredientPriceIssueStatus
  statusLabel: string
  issueDetail: string
  history: IngredientPriceMonitorPoint[]
  receipts: IngredientPriceMonitorReceipt[]
  menuImpact: IngredientPriceMonitorMenuImpact[]
}

export type IngredientPriceMonitoringData = {
  generatedAt: string
  days: number
  storeId: string | null
  stores: Array<{ id: string; name: string }>
  categories: string[]
  kpis: IngredientPriceMonitorKpis
  rows: IngredientPriceMonitorRow[]
}
