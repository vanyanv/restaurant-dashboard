import { notFound, redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getRecipeDetail, listRecipes } from "@/app/actions/recipe-actions"
import {
  getMenuItemSellPrices,
  getMenuItemsForCatalog,
} from "@/app/actions/menu-item-actions"
import { MenuItemDetailView } from "./menu-item-detail-view"

export default async function MenuItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const [detail, recipes, sellPrices, otterMappings] = await Promise.all([
    getRecipeDetail(id),
    listRecipes(),
    getMenuItemSellPrices(30),
    getMenuItemsForCatalog(),
  ])

  if (!detail) notFound()

  // Mirror the catalog's sell-price resolution for this single recipe.
  const recipe = detail.recipe
  const direct = sellPrices.get(recipe.itemName.toLowerCase())
  let resolved: {
    avgPrice: number
    qtySold: number
    sourceOtterName: string
  } | null = null
  if (direct) {
    resolved = {
      avgPrice: direct.avgPrice,
      qtySold: direct.qtySold,
      sourceOtterName: recipe.itemName,
    }
  } else {
    const mapped = otterMappings.filter(
      (m) =>
        m.mappedRecipeId === recipe.id &&
        sellPrices.has(m.otterItemName.toLowerCase())
    )
    let bestQty = -1
    for (const m of mapped) {
      const sp = sellPrices.get(m.otterItemName.toLowerCase())
      if (sp && sp.qtySold > bestQty) {
        bestQty = sp.qtySold
        resolved = {
          avgPrice: sp.avgPrice,
          qtySold: sp.qtySold,
          sourceOtterName: m.otterItemName,
        }
      }
    }
  }

  const summary = recipes.find((r) => r.id === id) ?? null

  return (
    <MenuItemDetailView
      recipe={{
        id: recipe.id,
        itemName: recipe.itemName,
        category: recipe.category,
        isConfirmed: recipe.isConfirmed,
        isSellable: recipe.isSellable,
        servingSize: recipe.servingSize,
        notes: recipe.notes,
        updatedAt: recipe.updatedAt,
        ingredientCount: summary?.ingredientCount ?? 0,
        computedCost: summary?.computedCost ?? null,
        partialCost: summary?.partialCost ?? true,
      }}
      cost={detail.cost}
      sell={resolved}
    />
  )
}
