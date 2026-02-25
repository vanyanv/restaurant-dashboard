// ─── Recipe types ───

export interface RecipeIngredientInput {
  ingredientName: string
  quantity: number
  unit: string
  notes?: string
}

export interface RecipeInput {
  itemName: string
  category: string
  servingSize?: number
  notes?: string
  ingredients: RecipeIngredientInput[]
}

export interface RecipeWithIngredients {
  id: string
  itemName: string
  category: string
  servingSize: number
  notes: string | null
  isAiGenerated: boolean
  isConfirmed: boolean
  ingredients: {
    id: string
    ingredientName: string
    quantity: number
    unit: string
    notes: string | null
  }[]
}

// ─── Usage calculation types ───

export interface IngredientUsageRow {
  ingredientName: string
  canonicalName: string
  category: string | null
  purchasedQuantity: number
  purchasedUnit: string
  purchasedCost: number
  avgUnitCost: number
  invoiceCount: number
  theoreticalUsage: number
  varianceQuantity: number
  variancePct: number
  wasteEstimatedCost: number
  status: "over_ordered" | "under_ordered" | "balanced" | "no_recipe"
}

export interface ProductUsageKpis {
  totalPurchasedCost: number
  theoreticalIngredientCost: number
  wasteEstimatedCost: number
  wastePercent: number
  ingredientsTracked: number
  recipesConfigured: number
  menuItemsCovered: number
}

export interface MenuItemCostRow {
  itemName: string
  category: string
  totalQuantitySold: number
  totalSalesRevenue: number
  theoreticalCOGS: number
  grossProfitEstimate: number
  grossMarginPct: number | null
  hasRecipe: boolean
}

export interface VendorPriceTrend {
  productName: string
  category: string | null
  unit: string | null
  dataPoints: { date: string; avgUnitPrice: number; vendor: string }[]
  priceChangePercent: number | null
}

export interface CategorySummaryRow {
  category: string
  purchasedCost: number
  theoreticalUsageCost: number
  varianceCost: number
  variancePct: number
}

// ─── Alert types ───

export interface PriceAlert {
  productName: string
  category: string | null
  previousAvgPrice: number
  currentPrice: number
  changePercent: number
  severity: "increase" | "decrease" | "spike"
  message: string
}

export interface OrderAnomaly {
  productName: string
  type: "new_product" | "quantity_spike" | "unexpected_vendor"
  details: string
  invoiceDate: string
  vendorName: string
}

// ─── AI types ───

export interface AiRecipeSuggestion {
  itemName: string
  category: string
  confidence: number
  ingredients: RecipeIngredientInput[]
  reasoning: string
}

export interface DemandForecast {
  ingredientName: string
  predictedUsageNextWeek: number
  unit: string
  suggestedOrderQty: number
  currentEstimatedStock: number
  confidence: "high" | "medium" | "low"
  reasoning: string
  needsReorder: boolean
}

export interface AnomalyExplanation {
  alertId: string
  explanation: string
  suggestedAction: string
  confidence: "high" | "medium" | "low"
}

export interface WeeklyComparison {
  currentWeekSpend: number
  previousWeekSpend: number
  spendChangePct: number
  currentWeekSales: number
  previousWeekSales: number
  salesChangePct: number
  observations: string[]
  topSpendChanges: {
    productName: string
    thisWeek: number
    lastWeek: number
    changePct: number
    reason: "price" | "volume" | "both" | "new"
  }[]
}

// ─── Page-level response ───

export interface ProductUsageData {
  kpis: ProductUsageKpis
  ingredientUsage: IngredientUsageRow[]
  menuItemCosts: MenuItemCostRow[]
  categoryBreakdown: CategorySummaryRow[]
  vendorPriceTrends: VendorPriceTrend[]
  priceAlerts: PriceAlert[]
  orderAnomalies: OrderAnomaly[]
  recipes: RecipeWithIngredients[]
  dateRange: { startDate: string; endDate: string }
  hasRecipes: boolean
}

export interface MenuItemForRecipeBuilder {
  itemName: string
  category: string
  hasRecipe: boolean
  totalQuantitySold: number
}
