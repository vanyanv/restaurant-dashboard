import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { listRecipes } from "@/app/actions/recipe-actions"
import { PageHead } from "@/components/mobile/page-head"
import { Panel } from "@/components/mobile/panel"
import { RecipesSearch } from "./recipes-search"

export const dynamic = "force-dynamic"

export default async function MobileRecipesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const recipes = await listRecipes()
  const confirmed = recipes.filter((r) => r.isConfirmed).length
  const sellable = recipes.filter((r) => r.isSellable).length

  return (
    <>
      <PageHead
        dept="CATALOG"
        title="Recipes"
        sub={`${recipes.length} total · ${confirmed} confirmed · ${sellable} sellable`}
      />

      <div className="dock-in dock-in-2" style={{ marginBottom: 14 }}>
        <div className="m-readonly-note">
          Read-only on mobile · build and edit recipes on desktop
        </div>
      </div>

      <div className="dock-in dock-in-3">
        <Panel flush>
          <RecipesSearch
            rows={recipes.map((r) => ({
              id: r.id,
              itemName: r.itemName,
              category: r.category,
              isSellable: r.isSellable,
              isConfirmed: r.isConfirmed,
              ingredientCount: r.ingredientCount,
              computedCost: r.computedCost,
              partialCost: r.partialCost,
            }))}
          />
        </Panel>
      </div>
    </>
  )
}
