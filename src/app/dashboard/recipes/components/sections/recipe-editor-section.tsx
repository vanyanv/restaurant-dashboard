import type { ReactNode } from "react"
import { getMenuItemsForCatalog } from "@/app/actions/menu-item-actions"
import { listRecipes } from "@/app/actions/recipe-actions"
import { listCanonicalIngredients } from "@/app/actions/canonical-ingredient-actions"
import {
  getRecipeSuggestions,
  type RecipeCandidate,
} from "@/app/actions/forecasts/recipe-suggestion-actions"
import { RecipesContent } from "../recipes-content"

type RecipesFilter = "unbuilt" | "all" | "prep" | "confirmed"

/**
 * Streams the recipes two-pane editor (menu-items list + recipe canvas) as a
 * single unit. Menu-items, recipe/canonical data, and F28 ML suggestions are
 * awaited in parallel so the editor mounts once everything is ready.
 *
 * Suggestions feed the per-row "ML proposes…" caption + Confirm pill on every
 * Unbuilt row — the steady-state mapping loop. They are read-only here; the
 * action just proposes, the operator confirms.
 */
export async function RecipeEditorSection({
  unmatchedCountSlot,
  initialFilter,
}: {
  unmatchedCountSlot?: ReactNode
  initialFilter?: RecipesFilter
}) {
  const [menuItems, recipes, canonicalIngredients, suggestionsResult] =
    await Promise.all([
      getMenuItemsForCatalog(),
      listRecipes(),
      listCanonicalIngredients(),
      getRecipeSuggestions({}),
    ])

  const suggestionsByItem = new Map<string, RecipeCandidate[]>()
  if (suggestionsResult && suggestionsResult.ok) {
    for (const item of suggestionsResult.data.items) {
      const key = item.itemName.toLowerCase()
      // Candidates rank against the account-wide recipe corpus and don't
      // depend on which store sold the item — first-write wins when the same
      // itemName appears across multiple stores.
      if (!suggestionsByItem.has(key)) {
        suggestionsByItem.set(key, item.candidates)
      }
    }
  }

  return (
    <RecipesContent
      initialMenuItems={menuItems}
      initialRecipes={recipes}
      initialCanonicalIngredients={canonicalIngredients}
      unmatchedCountSlot={unmatchedCountSlot}
      initialFilter={initialFilter}
      suggestionsByItem={suggestionsByItem}
    />
  )
}
