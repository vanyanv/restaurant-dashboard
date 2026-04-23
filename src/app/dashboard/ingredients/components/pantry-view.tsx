"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { IngredientsPantry } from "./ingredients-pantry"
import { ReviewInbox } from "./review-inbox"
import type { CanonicalIngredientSummary } from "@/types/recipe"
import type { UnmatchedLineItemGroup } from "@/app/actions/ingredient-match-actions"

type Props = {
  initialCanonicals: CanonicalIngredientSummary[]
  initialUnmatched: UnmatchedLineItemGroup[]
  initialOpenId?: string | null
}

/**
 * Combined pantry + review-inbox client composition. They share state:
 * - `onCanonicalCreated` (from review-inbox) adds to the pantry list.
 * - `onMatched` removes a group from the review inbox and refreshes.
 */
export function PantryView({
  initialCanonicals,
  initialUnmatched,
  initialOpenId,
}: Props) {
  const router = useRouter()
  const [canonicals, setCanonicals] = useState(initialCanonicals)
  const [unmatched, setUnmatched] = useState(initialUnmatched)

  return (
    <>
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
    </>
  )
}
