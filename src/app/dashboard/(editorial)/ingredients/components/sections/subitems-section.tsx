import { getOtterSubItemsForCatalog } from "@/app/actions/menu-item-actions"
import { listRecipes } from "@/app/actions/recipe-actions"
import { ModifiersDrawer } from "../modifiers-drawer"

/**
 * Server section: Otter sub-item (modifier) catalog.
 *
 * This is secondary content — the drawer is collapsed by default, and it's
 * only relevant when the owner has Otter order history with modifiers.
 * Streaming it in its own Suspense boundary keeps it from blocking the
 * pantry paint.
 *
 * `listRecipes()` is fetched here (not on the page shell) because the drawer
 * is the only consumer of the full recipe list on this page — the modifier
 * mapping picker needs it. Keeping both loaders inside this low-priority
 * boundary lets the pantry paint without waiting on recipe costs.
 */
export async function SubItemsSection() {
  const [subItems, recipes] = await Promise.all([
    getOtterSubItemsForCatalog(),
    listRecipes(),
  ])

  const unmappedMods = subItems.filter((s) => !s.mappedRecipeId).length

  return (
    <ModifiersDrawer
      subItems={subItems}
      recipes={recipes}
      unmappedCount={unmappedMods}
    />
  )
}
