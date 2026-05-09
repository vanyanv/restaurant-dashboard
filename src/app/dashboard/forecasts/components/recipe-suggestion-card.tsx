"use client"

import type {
  RecipeSuggestionConfidence,
  RecipeSuggestionData,
} from "@/app/actions/forecasts/recipe-suggestion-actions"

const CONFIDENCE_LABEL: Record<RecipeSuggestionConfidence, string> = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
}

const CONFIDENCE_CLASS: Record<RecipeSuggestionConfidence, string> = {
  high: "text-[var(--ink)] font-semibold",
  medium: "text-[var(--ink-muted)]",
  low: "text-[var(--ink-faint)]",
}

function fmtNum(n: number) {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

export function RecipeSuggestionCard({ data }: { data: RecipeSuggestionData }) {
  const itemsWithCandidates = data.items.filter((i) => i.candidates.length > 0)
  const itemsWithoutCandidates = data.items.filter(
    (i) => i.candidates.length === 0,
  )

  if (data.items.length === 0) {
    return (
      <section className="inv-panel">
        <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
          <span className="inv-panel__dept">Recipe suggestions</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            all items mapped
          </span>
        </header>
      </section>
    )
  }

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">
          Recipe suggestions · {data.items.length} unmapped
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          ranked by 30d qty · token-Jaccard match
        </span>
      </header>

      {itemsWithCandidates.length > 0 && (
        <div>
          <div className="grid grid-cols-[1.6fr_80px_2fr_80px_80px] gap-4 px-5 py-2 border-t border-[var(--hairline)] font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            <span>Unmapped item</span>
            <span className="text-right">30d qty</span>
            <span>Top suggestion</span>
            <span className="text-right">Match</span>
            <span className="text-right">Confidence</span>
          </div>
          {itemsWithCandidates.map((it) => {
            const top = it.candidates[0]
            return (
              <div
                key={`${it.storeId}::${it.category}::${it.itemName}`}
                className="grid grid-cols-[1.6fr_80px_2fr_80px_80px] gap-4 items-center px-5 py-2 border-t border-[var(--hairline)] hover:bg-[rgba(220,38,38,0.045)] transition-colors"
              >
                <div
                  className="text-[14px] text-[var(--ink)] truncate"
                  title={`${it.category} · ${it.itemName}`}
                >
                  {it.itemName}
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                    {it.category}
                  </span>
                </div>
                <div
                  className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
                  style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                >
                  {fmtNum(it.qty30d)}
                </div>
                <div
                  className="text-[14px] text-[var(--ink)] truncate"
                  title={
                    it.candidates
                      .map(
                        (c) =>
                          `${c.recipeName} (${(c.similarity * 100).toFixed(0)}%)`,
                      )
                      .join(" · ")
                  }
                >
                  → {top.recipeName}
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                    {top.ingredientCount} ingr
                  </span>
                </div>
                <div
                  className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
                  style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                >
                  {(top.similarity * 100).toFixed(0)}%
                </div>
                <div
                  className={`text-right font-mono text-[10px] uppercase tracking-[0.18em] ${CONFIDENCE_CLASS[top.confidence]}`}
                >
                  {CONFIDENCE_LABEL[top.confidence]}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {itemsWithoutCandidates.length > 0 && (
        <div className="px-5 py-3 border-t border-[var(--hairline-bold)]">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] mb-1">
            No close match · {itemsWithoutCandidates.length} item
            {itemsWithoutCandidates.length === 1 ? "" : "s"}
          </div>
          <div className="text-[13px] text-[var(--ink-muted)]">
            {itemsWithoutCandidates
              .slice(0, 8)
              .map((i) => i.itemName)
              .join(" · ")}
            {itemsWithoutCandidates.length > 8 ? " · …" : ""}
          </div>
        </div>
      )}
    </section>
  )
}
