import type {
  getMenuItemSellPrices,
  getMenuItemsForCatalog,
} from "@/app/actions/menu-item-actions"

type SellPriceMap = Awaited<ReturnType<typeof getMenuItemSellPrices>>
type OtterMappings = Awaited<ReturnType<typeof getMenuItemsForCatalog>>

export type ResolvedSellPrice = {
  avgPrice: number
  qtySold: number
  sourceOtterName: string
}

/**
 * Resolve the best sell price + qty-sold for a recipe, trying the recipe's
 * own name first, then walking Otter→recipe mappings and picking the
 * most-sold mapped item.
 */
export function resolveSellPriceForRecipe(
  recipeId: string,
  recipeName: string,
  sellPrices: SellPriceMap,
  otterMappings: OtterMappings
): ResolvedSellPrice | null {
  const direct = sellPrices.get(recipeName.toLowerCase())
  if (direct) {
    return {
      avgPrice: direct.avgPrice,
      qtySold: direct.qtySold,
      sourceOtterName: recipeName,
    }
  }
  let best: ResolvedSellPrice | null = null
  let bestQty = -1
  for (const m of otterMappings) {
    if (m.mappedRecipeId !== recipeId) continue
    const sp = sellPrices.get(m.otterItemName.toLowerCase())
    if (sp && sp.qtySold > bestQty) {
      bestQty = sp.qtySold
      best = {
        avgPrice: sp.avgPrice,
        qtySold: sp.qtySold,
        sourceOtterName: m.otterItemName,
      }
    }
  }
  return best
}
