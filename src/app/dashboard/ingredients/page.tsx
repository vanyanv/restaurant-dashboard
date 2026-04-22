import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { listCanonicalIngredients } from "@/app/actions/canonical-ingredient-actions"
import { listUnmatchedLineItems } from "@/app/actions/ingredient-match-actions"
import { getOtterSubItemsForCatalog } from "@/app/actions/menu-item-actions"
import { listRecipes } from "@/app/actions/recipe-actions"
import { IngredientsContent } from "./components/ingredients-content"

export default async function IngredientsPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const [{ open }, canonicals, unmatched, subItems, recipes] = await Promise.all([
    searchParams,
    listCanonicalIngredients(),
    listUnmatchedLineItems(),
    getOtterSubItemsForCatalog(),
    listRecipes(),
  ])

  return (
    <IngredientsContent
      initialCanonicals={canonicals}
      initialUnmatched={unmatched}
      initialSubItems={subItems}
      initialRecipes={recipes}
      initialOpenId={open ?? null}
    />
  )
}
