"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { IngredientsPantry } from "./ingredients-pantry"
import { PantryLedger } from "./ledger/pantry-ledger"
import { ReviewInbox } from "./review-inbox"
import type { CanonicalIngredientSummary } from "@/types/recipe"
import type { UnmatchedLineItemGroup } from "@/app/actions/ingredient-match-actions"
import type { PantryLedgerData } from "@/app/actions/pantry-ledger-actions"

type Props = {
  initialCanonicals: CanonicalIngredientSummary[]
  initialUnmatched: UnmatchedLineItemGroup[]
  ledger: PantryLedgerData
  initialOpenId?: string | null
}

type View = "ledger" | "cards"

/**
 * Combined pantry + review-inbox client composition. They share state:
 * - `onCanonicalCreated` (from review-inbox) adds to the pantry list.
 * - `onMatched` removes a group from the review inbox and refreshes.
 *
 * The ledger is the default view; the tile grid stays reachable behind the
 * toggle. That is deliberate for the first release — if the ledger turns out
 * not to work in daily use, it is a switch rather than a revert. A deep link
 * (`?open=`) still targets the tile grid's detail sheet, so it opens there.
 */
export function PantryView({
  initialCanonicals,
  initialUnmatched,
  ledger,
  initialOpenId,
}: Props) {
  const router = useRouter()
  const [canonicals, setCanonicals] = useState(initialCanonicals)
  const [unmatched, setUnmatched] = useState(initialUnmatched)
  const [view, setView] = useState<View>(initialOpenId ? "cards" : "ledger")

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

      <div className="flex items-center gap-2 border-b border-[var(--hairline-bold)] bg-[var(--paper)]/60 px-8 py-3">
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
          View
        </span>
        {(["ledger", "cards"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={cn(
              "border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition",
              view === v
                ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                : "border-[var(--hairline-bold)] bg-[var(--paper)] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
            )}
          >
            {v === "ledger" ? "Ledger" : "Cards"}
          </button>
        ))}
      </div>

      {view === "ledger" ? (
        <PantryLedger data={ledger} />
      ) : (
        <IngredientsPantry
          canonicals={canonicals}
          initialOpenId={initialOpenId ?? null}
        />
      )}
    </>
  )
}
