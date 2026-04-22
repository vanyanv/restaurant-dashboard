"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { EditorialTopbar } from "../../components/editorial-topbar"
import { IngredientsPantry } from "./ingredients-pantry"
import { ReviewInbox } from "./review-inbox"
import { ModifiersDrawer } from "./modifiers-drawer"
import type { CanonicalIngredientSummary, RecipeSummary } from "@/types/recipe"
import type { UnmatchedLineItemGroup } from "@/app/actions/ingredient-match-actions"
import type { OtterSubItemForCatalog } from "@/app/actions/menu-item-actions"

type Props = {
  initialCanonicals: CanonicalIngredientSummary[]
  initialUnmatched: UnmatchedLineItemGroup[]
  initialSubItems: OtterSubItemForCatalog[]
  initialRecipes: RecipeSummary[]
  initialOpenId?: string | null
}

export function IngredientsContent({
  initialCanonicals,
  initialUnmatched,
  initialSubItems,
  initialRecipes,
  initialOpenId,
}: Props) {
  const router = useRouter()
  const [canonicals, setCanonicals] = useState(initialCanonicals)
  const [unmatched, setUnmatched] = useState(initialUnmatched)

  const unmappedMods = initialSubItems.filter((s) => !s.mappedRecipeId).length
  const unpricedCount = canonicals.filter(
    (c) => c.costPerRecipeUnit == null
  ).length

  return (
    <div className="editorial-surface flex min-h-[calc(100vh-3.5rem)] flex-col">
      <EditorialTopbar
        section="§ 11"
        title="Pantry"
        stamps={
          <span>
            {canonicals.length} stocked
            {unpricedCount > 0 && <> · {unpricedCount} unpriced</>}
            {unmatched.length > 0 && (
              <> · {unmatched.length} to review</>
            )}
          </span>
        }
      />

      {unmatched.length > 0 && (
        <ReviewInbox
          groups={unmatched}
          canonicals={canonicals}
          onMatched={(key) => {
            setUnmatched((prev) => prev.filter((g) => g.key !== key))
            router.refresh()
          }}
          onCanonicalCreated={(created) => {
            setCanonicals((prev) =>
              [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
            )
          }}
        />
      )}

      <IngredientsPantry
        canonicals={canonicals}
        initialOpenId={initialOpenId ?? null}
      />

      <ModifiersDrawer
        subItems={initialSubItems}
        recipes={initialRecipes}
        unmappedCount={unmappedMods}
      />
    </div>
  )
}
