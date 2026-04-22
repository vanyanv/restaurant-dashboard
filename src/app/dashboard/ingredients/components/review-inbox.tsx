"use client"

import { useState } from "react"
import { ArrowRight, ChevronDown, Receipt } from "lucide-react"
import { cn } from "@/lib/utils"
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
  const [showAll, setShowAll] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)

  if (groups.length === 0) return null

  const visible = showAll ? groups : groups.slice(0, INITIAL_VISIBLE)
  const overflow = groups.length - INITIAL_VISIBLE
  const activeGroup =
    activeKey != null ? groups.find((g) => g.key === activeKey) ?? null : null

  return (
    <section
      className="border-b border-[var(--hairline-bold)] px-8 py-6"
      style={{
        background:
          "linear-gradient(180deg, rgba(252, 236, 236, 0.5) 0%, rgba(252, 236, 236, 0.1) 100%)",
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-dashed border-[var(--accent-dark)]/25 pb-4">
        <div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-dark)]">
            <span
              className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-dark)]"
              aria-hidden
            />
            § needs your review
          </div>
          <h2 className="mt-1.5 font-display text-[28px] italic leading-tight text-[var(--ink)]">
            {groups.length} new {groups.length === 1 ? "item" : "items"} on your
            invoices.
          </h2>
          <p className="mt-1 max-w-xl font-mono text-[10px] leading-relaxed text-[var(--ink-muted)]">
            Match each to an existing pantry ingredient or create a new one.
            Matching once teaches the system — future invoices for the same
            vendor + SKU will auto-link.
          </p>
        </div>
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
        {visible.map((g) => (
          <ReviewCard
            key={g.key}
            group={g}
            onOpen={() => setActiveKey(g.key)}
          />
        ))}
      </ul>

      {overflow > 0 && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex items-center gap-1.5 border border-[var(--hairline-bold)] bg-[var(--paper)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"
          >
            <ChevronDown
              className={cn("h-3 w-3 transition", showAll && "rotate-180")}
            />
            {showAll ? "Collapse" : `Show ${overflow} more`}
          </button>
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
        </div>

        <span className="inline-flex h-9 shrink-0 items-center gap-1.5 border-2 border-[var(--ink)] bg-[var(--ink)] px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--paper)] transition group-hover:bg-[var(--accent-dark)]">
          Match
          <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
        </span>
      </button>
    </li>
  )
}
