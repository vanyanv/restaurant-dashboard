export type OtterSubItemForCatalog = {
  skuId: string
  /** Most common display name for this SKU. */
  name: string
  /** Parent sub-header (e.g. "Add Toppings (Meat & Cheese Base)") — most common seen. */
  subHeader: string | null
  occurrences: number
  firstSeen: Date | null
  lastSeen: Date | null
  storeIds: string[]
  mappedRecipeId: string | null
  mappedRecipeName: string | null
}
