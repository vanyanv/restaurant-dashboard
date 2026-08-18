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
  // Keyed by decision id: a failed undo on one row must not read as a
  // message about a different row, and a later successful undo clears the
  // stale failure so it cannot outlive the thing it described.
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()

  const summary = summarizeAutoMatchNotice(decisions)
  if (!summary.show) return null

  // Mirrors the three-way shape auto-match-log.tsx already uses on the audit
  // page for the analogous case, so "0 items linked without you" — reachable
  // whenever every live decision in the window has since been undone — never
  // renders. The undone count is always folded into the headline here (both
  // branches below state it), so the caption never repeats it.
  const headline =
    summary.liveCount > 0 && summary.undoneCount > 0
      ? `${summary.liveCount} linked, ${summary.undoneCount} undone`
      : summary.liveCount === 0 && summary.undoneCount > 0
        ? `${summary.undoneCount} automatic ${summary.undoneCount === 1 ? "link" : "links"} undone`
        : `${summary.liveCount} ${summary.liveCount === 1 ? "item" : "items"} linked without you`

  const captionParts = [
    summary.linkedLineCount > 0
      ? `${summary.linkedLineCount} invoice ${summary.linkedLineCount === 1 ? "line" : "lines"}`
      : null,
    `last ${days} days`,
  ].filter((part): part is string => part != null)

  return (
    <section className="border-b border-[var(--hairline-bold)] bg-[var(--paper-deep)]/30">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-8 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
          § matched automatically
        </span>
        <span className="text-[13px] font-medium tabular-nums text-[var(--ink)]">
          {headline}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
          {captionParts.join(" · ")}
        </span>

        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="auto-match-notice"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto inline-flex items-center gap-1.5 border border-[var(--hairline-bold)] bg-[var(--paper)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"
        >
          <ChevronDown className={cn("h-3 w-3 transition", expanded && "rotate-180")} />
          {expanded ? "Hide links" : "Show links"}
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
                  <>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setErrors((prev) => {
                          if (!(d.id in prev)) return prev
                          const next = { ...prev }
                          delete next[d.id]
                          return next
                        })
                        startTransition(async () => {
                          try {
                            await undoAutoMatch(d.id)
                            setUndoneIds((prev) => new Set(prev).add(d.id))
                            setErrors((prev) => {
                              if (!(d.id in prev)) return prev
                              const next = { ...prev }
                              delete next[d.id]
                              return next
                            })
                          } catch (e) {
                            setErrors((prev) => ({
                              ...prev,
                              [d.id]: e instanceof Error ? e.message : "Undo failed",
                            }))
                          }
                        })
                      }}
                      className="ml-auto inline-flex items-center gap-1.5 border border-[var(--hairline-bold)] bg-[var(--paper)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-muted)] transition hover:border-[var(--accent-dark)] hover:text-[var(--accent-dark)] disabled:opacity-50"
                    >
                      <Undo2 className="h-2.5 w-2.5" />
                      Undo
                    </button>
                    {errors[d.id] && (
                      <span className="font-mono text-[9px] text-[var(--accent-dark)]">
                        {errors[d.id]}
                      </span>
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
