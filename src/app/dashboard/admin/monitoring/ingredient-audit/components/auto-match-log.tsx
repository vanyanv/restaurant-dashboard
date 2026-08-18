"use client"

// The auto-match ladder's receipt. Every automatic link (and every shadow
// decision that WOULD have been a link) shows up here with what it chose,
// how sure it was, what else it considered, and a one-click undo.
//
// Design intent: this strip exists to make a wrong pick diagnosable, not
// merely reversible. The collapsed row answers "what did it do"; expanding
// answers "why, and what were the alternatives" — the scored runner-ups are
// the part that lets an owner tell a confident correct pick from a confident
// wrong one. Undo is per row and permanent: the ladder reads UNDONE
// decisions and never re-proposes that pairing.

import { useState, useTransition } from "react"
import { ChevronDown, Undo2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { prettifyIngredientName } from "@/app/dashboard/recipes/components/ingredient-picker-utils"
import { undoAutoMatch } from "@/app/actions/ingredient-auto-match-actions"
import type { RecentAutoMatch } from "@/app/actions/ingredient-auto-match-actions"

type Props = {
  decisions: RecentAutoMatch[]
  days: number
}

const INITIAL_VISIBLE = 5

/** Layer → how it decided, in the operator's vocabulary rather than the
 * codebase's. `auto-llm` is called out because it is the only rung carrying a
 * measured error rate — the other two are exact-name and a gated similarity
 * score. */
const LAYER_LABEL: Record<string, string> = {
  "auto-exact": "Exact name",
  "auto-vector": "Similarity",
  "auto-llm": "AI review",
}

export function AutoMatchLog({ decisions, days }: Props) {
  const [showAll, setShowAll] = useState(false)
  // Undone rows stay in place rather than vanishing: the row IS the record
  // that the automation was corrected here, and it is what suppresses a
  // re-link. Removing it would read as "that never happened".
  const [undoneIds, setUndoneIds] = useState<Set<string>>(new Set())

  if (decisions.length === 0) return null

  const visible = showAll ? decisions : decisions.slice(0, INITIAL_VISIBLE)
  const overflow = decisions.length - INITIAL_VISIBLE
  const shadowCount = decisions.filter((d) => d.status === "SHADOW").length
  const liveCount = decisions.length - shadowCount

  return (
    <section className="border-b border-[var(--hairline-bold)] bg-[var(--paper-deep)]/30 px-8 py-6">
      <div className="inv-panel inv-panel--flush">
        <div className="inv-panel__head px-5 pt-4">
          <div>
            <div className="inv-panel__dept">§ matched automatically</div>
            <h2 className="inv-panel__title mt-1.5">
              {liveCount > 0 && shadowCount > 0
                ? `${liveCount} linked, ${shadowCount} proposed`
                : shadowCount > 0
                  ? `${shadowCount} ${shadowCount === 1 ? "item" : "items"} the system would have linked`
                  : `${liveCount} ${liveCount === 1 ? "item" : "items"} linked without you`}
            </h2>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
            last {days} days
          </span>
        </div>

        {shadowCount > 0 && (
          <p className="px-5 pb-3 font-mono text-[10px] leading-relaxed text-[var(--ink-muted)]">
            Shadow rows are proposals only — nothing on your invoices was
            changed. They show what auto-matching would have done if it were on.
          </p>
        )}

        <ul>
          {visible.map((d) => (
            <ActivityRow
              key={d.id}
              decision={d}
              undone={undoneIds.has(d.id) || d.status === "UNDONE"}
              onUndone={() =>
                setUndoneIds((prev) => new Set(prev).add(d.id))
              }
            />
          ))}
        </ul>
      </div>

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
    </section>
  )
}

function ActivityRow({
  decision,
  undone,
  onUndone,
}: {
  decision: RecentAutoMatch
  undone: boolean
  onUndone: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const target = decision.canonicalIngredientName
    ? prettifyIngredientName(decision.canonicalIngredientName)
    : "(ingredient removed)"

  // Runner-ups only — the accepted candidate is already named in the row, and
  // repeating it in the "also considered" list would misrepresent how many
  // alternatives there actually were.
  const runnerUps = (decision.candidates ?? []).filter(
    (c) => c.id !== decision.canonicalIngredientId
  )

  function handleUndo() {
    setError(null)
    startTransition(async () => {
      try {
        await undoAutoMatch(decision.id)
        onUndone()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Undo failed")
      }
    })
  }

  return (
    <li className={cn(undone && "opacity-55")}>
      {/* A real <button>, not a div with role="button" — .inv-row is already
          a button surface elsewhere on the dashboard, and it gets Enter/Space
          and focus-visible for free. The undo control lives in the expanded
          panel below, never nested inside this one. */}
      <button
        type="button"
        className="auto-match-row inv-row"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="auto-match-row__product">
          <strong title={decision.productName}>
            {prettifyIngredientName(decision.productName)}
          </strong>
          <em>
            {decision.vendorName}
            {decision.sku ? ` · SKU ${decision.sku}` : ""}
            {decision.linkedLineItemCount > 1
              ? ` · ${decision.linkedLineItemCount} lines`
              : ""}
          </em>
        </span>

        <span className="auto-match-row__target">
          <strong title={decision.canonicalIngredientName ?? undefined}>
            {target}
          </strong>
          <em>
            {undone
              ? "undone"
              : decision.status === "SHADOW"
                ? "proposed only"
                : "linked"}
          </em>
        </span>

        <span
          className={cn(
            "auto-match-row__layer",
            decision.layer === "auto-llm" && "is-llm"
          )}
        >
          {LAYER_LABEL[decision.layer] ?? decision.layer}
        </span>

        <span className="auto-match-row__confidence">
          {(decision.confidence * 100).toFixed(0)}%
        </span>

        <ChevronDown
          className={cn(
            "auto-match-row__chev h-3.5 w-3.5 transition",
            expanded && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className="auto-match-row__detail">
          {decision.reasoning && (
            <p className="auto-match-row__reasoning">
              &ldquo;{decision.reasoning}&rdquo;
              {decision.model && (
                <span className="auto-match-row__model"> — {decision.model}</span>
              )}
            </p>
          )}

          <dl className="auto-match-row__scores">
            {decision.topScore != null && (
              <div>
                <dt>Top similarity</dt>
                <dd>{decision.topScore.toFixed(3)}</dd>
              </div>
            )}
            {decision.margin != null && (
              <div>
                <dt>Margin over runner-up</dt>
                <dd>{decision.margin.toFixed(3)}</dd>
              </div>
            )}
          </dl>

          {runnerUps.length > 0 && (
            <div className="auto-match-row__runners">
              <div className="auto-match-row__runners-label">Also considered</div>
              <ul>
                {runnerUps.map((c) => (
                  <li key={c.id}>
                    <span>{prettifyIngredientName(c.name)}</span>
                    <span className="auto-match-row__runner-score">
                      {c.score.toFixed(3)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="auto-match-row__actions">
            {undone ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                Undone — this pairing will not be proposed again
              </span>
            ) : (
              <button
                type="button"
                onClick={handleUndo}
                disabled={pending}
                className="inline-flex items-center gap-1.5 border border-[var(--hairline-bold)] bg-[var(--paper)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
              >
                <Undo2 className="h-3 w-3" />
                {pending ? "Undoing..." : "Undo this match"}
              </button>
            )}
            {error && (
              <span className="font-mono text-[10px] text-[var(--accent-dark)]">
                {error}
              </span>
            )}
          </div>
        </div>
      )}
    </li>
  )
}
