"use client"

// What the ladder linked without asking, and how to take it back.
//
// This is the owner's half of the auto-match surface; the diagnostic half —
// confidence, margin, scored runner-ups, model reasoning — lives on
// /dashboard/admin/monitoring/ingredient-audit. The split is deliberate: an
// owner's question is "what did it change to my pantry", and answering that
// with a scoring table is why the ledger used to start below the fold.
//
// Renders nothing in SHADOW mode. A proposal that wrote no data is not news.

import { useState, useTransition } from "react"
import { ChevronDown, Undo2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { summarizeAutoMatchNotice } from "@/lib/pantry-attention"
import { prettifyIngredientName } from "../../recipes/components/ingredient-picker-utils"
import { undoAutoMatch } from "@/app/actions/ingredient-auto-match-actions"
import type { RecentAutoMatch } from "@/app/actions/ingredient-auto-match-actions"

type Props = {
  decisions: RecentAutoMatch[]
  days: number
}

export function AutoMatchNotice({ decisions, days }: Props) {
  const [expanded, setExpanded] = useState(false)
  // An undone row stays in place: it is the record that the automation was
  // corrected here, and it is what stops the ladder re-proposing the pairing.
  const [undoneIds, setUndoneIds] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()

  const summary = summarizeAutoMatchNotice(decisions)
  if (!summary.show) return null

  return (
    <section className="border-b border-[var(--hairline-bold)] bg-[var(--paper-deep)]/30">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-8 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
          § matched automatically
        </span>
        <span className="text-[13px] font-medium tabular-nums text-[var(--ink)]">
          {summary.liveCount} {summary.liveCount === 1 ? "item" : "items"} linked
          without you
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
          {summary.linkedLineCount} invoice{" "}
          {summary.linkedLineCount === 1 ? "line" : "lines"} · last {days} days
          {summary.undoneCount > 0 ? ` · ${summary.undoneCount} undone` : ""}
        </span>

        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="auto-match-notice"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto inline-flex items-center gap-1.5 border border-[var(--hairline-bold)] bg-[var(--paper)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"
        >
          <ChevronDown className={cn("h-3 w-3 transition", expanded && "rotate-180")} />
          {expanded ? "Hide" : "Review"}
        </button>
      </div>

      {expanded && (
        <ul
          id="auto-match-notice"
          className="border-t border-[var(--hairline)] px-8 py-3"
        >
          {decisions.map((d) => {
            const undone = d.status === "UNDONE" || undoneIds.has(d.id)
            return (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-dashed border-[var(--hairline)] py-2 last:border-b-0"
              >
                <span
                  className={cn(
                    "text-[13px] text-[var(--ink)]",
                    undone && "text-[var(--ink-faint)] line-through"
                  )}
                >
                  {prettifyIngredientName(d.productName)}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
                  → {prettifyIngredientName(d.canonicalIngredientName ?? "—")} ·{" "}
                  {d.linkedLineItemCount}{" "}
                  {d.linkedLineItemCount === 1 ? "line" : "lines"}
                </span>

                {undone ? (
                  <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                    Undone
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await undoAutoMatch(d.id)
                        setUndoneIds((prev) => new Set(prev).add(d.id))
                      })
                    }
                    className="ml-auto inline-flex items-center gap-1.5 border border-[var(--hairline-bold)] bg-[var(--paper)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-muted)] transition hover:border-[var(--accent-dark)] hover:text-[var(--accent-dark)] disabled:opacity-50"
                  >
                    <Undo2 className="h-2.5 w-2.5" />
                    Undo
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
