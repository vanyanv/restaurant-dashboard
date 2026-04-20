import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { listCanonicalIngredients } from "@/app/actions/canonical-ingredient-actions"
import { listUnmatchedLineItems } from "@/app/actions/ingredient-match-actions"
import { getOtterSubItemsForCatalog } from "@/app/actions/menu-item-actions"
import { listRecipes } from "@/app/actions/recipe-actions"
import { IngredientsContent } from "./components/ingredients-content"

type Props = {
  searchParams: Promise<{ tab?: string }>
}

export default async function IngredientsPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const { tab } = await searchParams
  const initialTab =
    tab === "review" ? "review" : tab === "modifiers" ? "modifiers" : "catalog"

  const [canonicals, unmatched, subItems, recipes] = await Promise.all([
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
      initialTab={initialTab}
    />
  )
}
