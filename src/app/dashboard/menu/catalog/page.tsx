import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { resolveSellPriceForRecipe } from "@/lib/menu-sell-price"
import { MenuCatalogContent } from "./components/menu-catalog-content"
import { cachedCatalogBundle } from "@/lib/cached"

export default async function MenuCatalogPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const ownerId = session.user.id
  const { recipes, sellPrices, otterMappings } = await cachedCatalogBundle(ownerId)

  // Surface recipes the owner can actually sell; modifiers are plumbing.
  const menuRecipes = recipes.filter(
    (r) => r.isSellable && r.category !== "Modifier"
  )

  const rows = menuRecipes.map((r) => {
    const price = resolveSellPriceForRecipe(r.id, r.itemName, sellPrices, otterMappings)
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
