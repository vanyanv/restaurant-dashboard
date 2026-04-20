import { notFound, redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import {
  getRecipeCatalogSummary,
  getRecipeDetail,
} from "@/app/actions/recipe-actions"
import { MenuItemDetailView } from "./menu-item-detail-view"

export default async function MenuItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const [summary, detail] = await Promise.all([
    getRecipeCatalogSummary(id),
    getRecipeDetail(id),
  ])

  if (!summary || !detail) notFound()

  return (
    <MenuItemDetailView
      recipe={{
        id: detail.recipe.id,
        itemName: detail.recipe.itemName,
        category: detail.recipe.category,
        isConfirmed: detail.recipe.isConfirmed,
        isSellable: detail.recipe.isSellable,
        servingSize: detail.recipe.servingSize,
        notes: detail.recipe.notes,
        updatedAt: detail.recipe.updatedAt,
        ingredientCount: summary.ingredientCount,
        computedCost: summary.computedCost,
        partialCost: summary.partialCost,
      }}
      cost={detail.cost}
      sell={
        summary.sellPrice != null && summary.sellSourceName != null
          ? {
              avgPrice: summary.sellPrice,
              qtySold: summary.qtySold,
              sourceOtterName: summary.sellSourceName,
            }
          : null
      }
    />
  )
}
