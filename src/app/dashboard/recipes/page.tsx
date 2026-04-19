import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getMenuItemsForCatalog } from "@/app/actions/menu-item-actions"
import { listRecipes } from "@/app/actions/recipe-actions"
import { listCanonicalIngredients } from "@/app/actions/canonical-ingredient-actions"
import { RecipesContent } from "./components/recipes-content"

export default async function RecipesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

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
    />
  )
}
