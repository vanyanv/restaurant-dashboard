import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { listCanonicalIngredients } from "@/app/actions/canonical-ingredient-actions"
import { PageHead } from "@/components/mobile/page-head"
import { Panel } from "@/components/mobile/panel"
import { IngredientsSearch } from "./ingredients-search"

export const dynamic = "force-dynamic"

export default async function MobileIngredientsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const ingredients = await listCanonicalIngredients()

  const rows = ingredients.map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category,
    aliasCount: i.aliasCount,
    recipeUnit: i.recipeUnit,
    costPerRecipeUnit: i.costPerRecipeUnit,
    trendPct: i.trend30d?.pctChange ?? null,
  }))

  const costed = rows.filter((r) => r.costPerRecipeUnit != null).length

  return (
    <>
      <PageHead
        dept="CATALOG"
        title="Ingredients"
        sub={`${rows.length} canonical · ${costed} costed`}
      />

      <div className="dock-in dock-in-2" style={{ marginBottom: 14 }}>
        <div className="m-readonly-note">
          Read-only on mobile · edit costs and aliases on desktop
        </div>
      </div>

      <div className="dock-in dock-in-3">
        <Panel flush>
          <IngredientsSearch rows={rows} />
        </Panel>
      </div>
    </>
  )
}
