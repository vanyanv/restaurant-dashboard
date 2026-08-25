"use client"

import { useEffect, useState } from "react"
import { ArrowRight, ChevronDown, Receipt, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { summarizeReviewQueue } from "@/lib/pantry-attention"
import { formatMoney } from "@/lib/pantry-format"
import { prettifyIngredientName } from "../../recipes/components/ingredient-picker-utils"
import { MatchPickerSheet } from "./match-picker-sheet"
import type { UnmatchedLineItemGroup } from "@/app/actions/ingredient-match-actions"
import type { CanonicalIngredientSummary } from "@/types/recipe"

type Props = {
  groups: UnmatchedLineItemGroup[]
  canonicals: CanonicalIngredientSummary[]
  onMatched: (key: string, newCanonicalId: string) => void
  onCanonicalCreated: (created: CanonicalIngredientSummary) => void
}

const INITIAL_VISIBLE = 4

export function ReviewInbox({
  groups,
  canonicals,
  onMatched,
  onCanonicalCreated,
}: Props) {
  // Collapsed by default: this queue is 31 groups worth $4,133 against a
  // ledger that reports $175,226. It is a chore, not the headline, and it used
  // to push every ingredient below the fold.
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)

  // The sidebar's "Needs review" link is /dashboard/ingredients#review. Landing
  // on a collapsed bar would make that link look broken.
  useEffect(() => {
    const checkHash = () => {
      if (window.location.hash === "#review") setExpanded(true)
    }
    checkHash()

    // A same-page click on that link is a soft navigation — Next.js's <Link>
    // updates the URL via the History API, which does not fire `hashchange`
    // or `popstate` (confirmed empirically). Worse, if the hash is already
    // #review (e.g. re-clicking after collapsing manually) Next skips the
    // navigation entirely and no history event fires at all. What does
    // reliably fire in both cases is the click itself, which bubbles to the
    // document regardless of what the router does with it afterward.
    const onClick = (e: MouseEvent) => {
      const target = e.target
      if (!(target instanceof Element)) return
      const anchor = target.closest("a")
      if (anchor && anchor.hash === "#review") setExpanded(true)
    }
    document.addEventListener("click", onClick)
    window.addEventListener("hashchange", checkHash)

    return () => {
      document.removeEventListener("click", onClick)
      window.removeEventListener("hashchange", checkHash)
    }
  }, [])

  const summary = summarizeReviewQueue(groups)
  if (!summary.show) return null

  const visible = showAll ? groups : groups.slice(0, INITIAL_VISIBLE)
  const overflow = groups.length - INITIAL_VISIBLE
  const activeGroup =
    activeKey != null ? groups.find((g) => g.key === activeKey) ?? null : null

  return (
    <section
      id="review"
      className="scroll-mt-16 border-b border-[var(--hairline-bold)] bg-[var(--paper)]/60"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-8 py-3">
        <span
          className="inline-flex h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--accent-dark)]"
          aria-hidden
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-dark)]">
          § needs your review
        </span>
        <span className="text-[13px] font-medium tabular-nums text-[var(--ink)]">
          {summary.count} new {summary.count === 1 ? "item" : "items"} on your invoices
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
          {formatMoney(summary.totalSpend)}
        </span>

        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="review-queue"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto inline-flex items-center gap-1.5 border border-[var(--hairline-bold)] bg-[var(--paper)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"
        >
          <ChevronDown className={cn("h-3 w-3 transition", expanded && "rotate-180")} />
          {expanded ? "Hide" : "Review"}
        </button>
      </div>

      {expanded && (
        <div
          id="review-queue"
          className="border-t border-dashed border-[var(--accent-dark)]/25 px-8 pb-6 pt-4"
          style={{
            background:
              "linear-gradient(180deg, rgba(252, 236, 236, 0.5) 0%, rgba(252, 236, 236, 0.1) 100%)",
          }}
        >
          <p className="max-w-xl font-mono text-[10px] leading-relaxed text-[var(--ink-muted)]">
            Match each to an existing pantry ingredient or create a new one.
            Matching once teaches the system — future invoices for the same
            vendor + SKU will auto-link.
          </p>

          <ul className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
            {visible.map((g) => (
              <ReviewCard key={g.key} group={g} onOpen={() => setActiveKey(g.key)} />
            ))}
          </ul>

          {overflow > 0 && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="inline-flex items-center gap-1.5 border border-[var(--hairline-bold)] bg-[var(--paper)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"
              >
                <ChevronDown className={cn("h-3 w-3 transition", showAll && "rotate-180")} />
                {showAll ? "Collapse" : `Show ${overflow} more`}
              </button>
            </div>
          )}
        </div>
      )}

      <MatchPickerSheet
        open={activeGroup != null}
        onOpenChange={(o) => {
          if (!o) setActiveKey(null)
        }}
        group={activeGroup}
        canonicals={canonicals}
        onMatched={onMatched}
        onCanonicalCreated={onCanonicalCreated}
      />
    </section>
  )
}

function ReviewCard({
  group,
  onOpen,
}: {
  group: UnmatchedLineItemGroup
  onOpen: () => void
}) {
  const displayName = prettifyIngredientName(group.productName)

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group relative flex w-full items-center gap-4 border-2 border-[var(--hairline-bold)] bg-[var(--paper)] px-4 py-3.5 text-left transition hover:border-[var(--ink)] hover:shadow-[3px_3px_0_var(--hairline-bold)]"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center border border-[var(--accent-dark)]/30 bg-[var(--accent-bg)] text-[var(--accent-dark)]">
          <Receipt className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="truncate font-display text-[17px] italic leading-tight text-[var(--ink)]"
            title={group.productName}
          >
            {displayName}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
            <span className="text-[var(--ink-muted)]">{group.vendorName}</span>
            {group.sku && (
              <>
                <span>·</span>
                <span>SKU {group.sku}</span>
              </>
            )}
            <span>·</span>
            <span>
              ${group.totalSpend.toFixed(0)} · {group.occurrences}×
            </span>
          </div>

          {/* What auto-matching would have picked, if it had one. Shown on the
              card so the owner can triage the queue without opening every
              sheet — the pick itself is pre-selected inside. */}
          {group.suggestion && (
            <div className="mt-1 flex items-center gap-1.5 truncate font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--accent-dark)]">
              <Sparkles className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">
                {prettifyIngredientName(group.suggestion.canonicalName)}
              </span>
            </div>
          )}
        </div>

        <span className="inline-flex h-9 shrink-0 items-center gap-1.5 border-2 border-[var(--ink)] bg-[var(--ink)] px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--paper)] transition group-hover:bg-[var(--accent-dark)]">
          Match
          <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
        </span>
      </button>
    </li>
  )
}
