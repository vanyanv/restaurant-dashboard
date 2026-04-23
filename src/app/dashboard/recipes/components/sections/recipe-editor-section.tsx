import type { ReactNode } from "react"
import { getMenuItemsForCatalog } from "@/app/actions/menu-item-actions"
import { listRecipes } from "@/app/actions/recipe-actions"
import { listCanonicalIngredients } from "@/app/actions/canonical-ingredient-actions"
import { RecipesContent } from "../recipes-content"

/**
 * Streams the recipes two-pane editor (menu-items list + recipe canvas) as a
 * single unit. Menu-items and recipe/canonical data are awaited in parallel so
 * the editor mounts once all three are ready.
 *
 * Note on composition: the two visible panes share deep client state in
 * `RecipesContent` (selected menu item, open editor, drag/drop rows,
 * create-ingredient dialog, canonical refresh). Splitting them into
 * independently-suspended panes would require lifting that state to a
 * provider, which is outside the scope of this Layer-2 refactor. Instead we
 * stream the editor as one Suspense-able chunk and keep the unmatched-count
 * badge in its own lightweight boundary.
 */
export async function RecipeEditorSection({
  unmatchedCountSlot,
}: {
  unmatchedCountSlot?: ReactNode
}) {
  const [menuItems, recipes, canonicalIngredients] = await Promise.all([
    getMenuItemsForCatalog(),
    listRecipes(),
    listCanonicalIngredients(),
  ])

  return (
    <RecipesContent
      initialMenuItems={menuItems}
      initialRecipes={recipes}
      initialCanonicalIngredients={canonicalIngredients}
      unmatchedCountSlot={unmatchedCountSlot}
    />
  )
}
