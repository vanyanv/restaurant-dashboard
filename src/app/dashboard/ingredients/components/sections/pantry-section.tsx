import { listCanonicalIngredients } from "@/app/actions/canonical-ingredient-actions"
import { listUnmatchedLineItems } from "@/app/actions/ingredient-match-actions"
import { PantryView } from "../pantry-view"

type Props = {
  initialOpenId: string | null
}

/**
 * Server section: fetches canonical ingredients + unmatched invoice line-item
 * groups in parallel, then renders the combined pantry + review-inbox client
 * composition. These two loaders are grouped because the client composition
 * shares state between them (a canonical created during review must appear in
 * the pantry list without a full reload).
 */
export async function PantrySection({ initialOpenId }: Props) {
  const [canonicals, unmatched] = await Promise.all([
    listCanonicalIngredients(),
    listUnmatchedLineItems(),
  ])

  return (
    <PantryView
      initialCanonicals={canonicals}
      initialUnmatched={unmatched}
      initialOpenId={initialOpenId}
    />
  )
}
