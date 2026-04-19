import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { listCanonicalIngredients } from "@/app/actions/canonical-ingredient-actions"
import { listUnmatchedLineItems } from "@/app/actions/ingredient-match-actions"
import { IngredientsContent } from "./components/ingredients-content"

type Props = {
  searchParams: Promise<{ tab?: string }>
}

export default async function IngredientsPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const { tab } = await searchParams
  const initialTab = tab === "review" ? "review" : "catalog"

  const [canonicals, unmatched] = await Promise.all([
    listCanonicalIngredients(),
    listUnmatchedLineItems(),
  ])

  return (
    <IngredientsContent
      initialCanonicals={canonicals}
      initialUnmatched={unmatched}
      initialTab={initialTab}
    />
  )
}
