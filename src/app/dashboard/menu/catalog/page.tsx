import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { listRecipes } from "@/app/actions/recipe-actions"
import {
  getMenuItemSellPrices,
  getMenuItemsForCatalog,
} from "@/app/actions/menu-item-actions"
import { MenuCatalogContent } from "./components/menu-catalog-content"

export default async function MenuCatalogPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const [recipes, sellPrices, otterMappings] = await Promise.all([
    listRecipes(),
    getMenuItemSellPrices(30),
    getMenuItemsForCatalog(),
  ])

  // Surface recipes the owner can actually sell; modifiers are plumbing.
  const menuRecipes = recipes.filter(
    (r) => r.isSellable && r.category !== "Modifier"
  )

  // Reverse lookup: recipeId → best sell price. We try the recipe's itemName
  // first, then walk the Otter→recipe mappings that point at this recipe and
  // take the highest-confidence (most sold) price.
  const priceByRecipeId = new Map<
    string,
    { avgPrice: number; qtySold: number; sourceOtterName: string | null }
  >()
  for (const r of menuRecipes) {
    const direct = sellPrices.get(r.itemName.toLowerCase())
    if (direct) {
      priceByRecipeId.set(r.id, {
        avgPrice: direct.avgPrice,
        qtySold: direct.qtySold,
        sourceOtterName: r.itemName,
      })
      continue
    }
    // Otter items explicitly mapped to this recipe.
    const mapped = otterMappings.filter(
      (m) => m.mappedRecipeId === r.id && sellPrices.has(m.otterItemName.toLowerCase())
    )
    if (mapped.length === 0) continue
    // Pick the one with the most units sold (most signal).
    let best: typeof mapped[0] | null = null
    let bestQty = -1
    for (const m of mapped) {
      const sp = sellPrices.get(m.otterItemName.toLowerCase())
      if (sp && sp.qtySold > bestQty) {
        best = m
        bestQty = sp.qtySold
      }
    }
    if (best) {
      const sp = sellPrices.get(best.otterItemName.toLowerCase())!
      priceByRecipeId.set(r.id, {
        avgPrice: sp.avgPrice,
        qtySold: sp.qtySold,
        sourceOtterName: best.otterItemName,
      })
    }
  }

  const rows = menuRecipes.map((r) => {
    const price = priceByRecipeId.get(r.id) ?? null
    return {
      id: r.id,
      itemName: r.itemName,
      category: r.category,
      isConfirmed: r.isConfirmed,
      ingredientCount: r.ingredientCount,
      computedCost: r.computedCost,
      partialCost: r.partialCost,
      updatedAt: r.updatedAt,
      sellPrice: price?.avgPrice ?? null,
      qtySold: price?.qtySold ?? 0,
      sellSourceName: price?.sourceOtterName ?? null,
    }
  })

  return <MenuCatalogContent rows={rows} />
}
