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
  const canUploadPhotos = session.user.role === "DEVELOPER"

  const rows = ingredients.map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category,
    aliasCount: i.aliasCount,
    recipeUnit: i.recipeUnit,
    costPerRecipeUnit: i.costPerRecipeUnit,
    trendPct: i.trend30d?.pctChange ?? null,
    hasPhoto: i.hasPhoto,
    photoVersion: i.photoVersion,
  }))

  const costed = rows.filter((r) => r.costPerRecipeUnit != null).length
  const photographed = rows.filter((r) => r.hasPhoto).length

  return (
    <>
      <PageHead
        dept="CATALOG"
        title="Ingredients"
        sub={`${rows.length} canonical · ${costed} costed · ${photographed} with photo`}
      />

      <div className="dock-in dock-in-2" style={{ marginBottom: 14 }}>
        <div className="m-readonly-note">
          {canUploadPhotos
            ? "Tap any row to view or replace its reference photo."
            : "Read-only on mobile · edit costs and aliases on desktop"}
        </div>
      </div>

      <div className="dock-in dock-in-3">
        <Panel flush>
          <IngredientsSearch rows={rows} canUploadPhotos={canUploadPhotos} />
        </Panel>
      </div>
    </>
  )
}
