export type CanonicalIngredientSummary = {
  id: string
  name: string
  defaultUnit: string
  category: string | null
  aliasCount: number
  /** User-configured "recipe unit" (lb/oz/each/tbsp/...) — what recipes multiply against. */
  recipeUnit: string | null
  /** Dollars per recipeUnit. Null when unknown. */
  costPerRecipeUnit: number | null
  /** "manual" (user-entered) or "invoice" (derived from latest matched line item). */
  costSource: "manual" | "invoice" | null
  /** When true, invoice recomputes won't overwrite manual cost. */
  costLocked: boolean
  costUpdatedAt: Date | null
  /** Latest matched invoice line item (for reference / provenance). */
  latestUnitCost: number | null
  latestUnit: string | null
  latestPriceAt: Date | null
  latestVendor: string | null
  latestSku: string | null
}

export type RecipeIngredientInput = {
  /** Optional — only for updates. */
  id?: string
  /** Exactly one of these two must be set. */
  canonicalIngredientId?: string | null
  componentRecipeId?: string | null
  /** Optional display override. */
  ingredientName?: string | null
  quantity: number
  unit: string
  notes?: string | null
}

export type RecipeInput = {
  id?: string
  itemName: string
  category: string
  servingSize: number
  isSellable: boolean
  notes?: string | null
  foodCostOverride?: number | null
  ingredients: RecipeIngredientInput[]
}

export type RecipeSummary = {
  id: string
  itemName: string
  category: string
  isSellable: boolean
  isConfirmed: boolean
  ingredientCount: number
  computedCost: number | null
  partialCost: boolean
  updatedAt: Date
}

export type MenuItemForCatalog = {
  otterItemName: string
  category: string
  totalQtySoldAllTime: number
  firstSeen: Date
  lastSeen: Date
  mappedRecipeId: string | null
  mappedRecipeName: string | null
  storeIds: string[]
}
