"use client"

import type {
  WasteClusterData,
} from "@/app/actions/forecasts/waste-cluster-actions"
import type { WasteClusterLabel } from "@/lib/inventory/waste-clustering"

const LABEL_PROSE: Record<WasteClusterLabel, string> = {
  insufficient_data: "Insufficient data",
  stable_within_noise: "Stable",
  systematic_overuse: "Systematic overuse",
  systematic_underuse: "Systematic underuse",
  expiry_driven: "Expiry-driven",
  theft_or_unrecorded: "Theft / unrecorded",
  improving: "Improving",
}

const LABEL_CLASS: Record<WasteClusterLabel, string> = {
  insufficient_data: "text-[var(--ink-faint)]",
  stable_within_noise: "text-[var(--ink-muted)]",
  systematic_overuse: "text-[var(--accent)] font-semibold",
  systematic_underuse: "text-[var(--ink)]",
  expiry_driven: "text-[var(--accent)]",
  theft_or_unrecorded: "text-[var(--accent)] font-semibold",
  improving: "text-[var(--ink)] font-semibold",
}

const PRIORITY_ORDER: WasteClusterLabel[] = [
  "theft_or_unrecorded",
  "systematic_overuse",
  "expiry_driven",
  "systematic_underuse",
  "improving",
  "stable_within_noise",
  "insufficient_data",
]

function fmtUsd(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  })
}

function fmtPct(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—"
  const sign = n > 0 ? "+" : ""
  return `${sign}${(n * 100).toFixed(1)}%`
}

export function WasteClusterCard({ data }: { data: WasteClusterData }) {
  if (data.rows.length === 0) {
    return (
      <section className="inv-panel">
        <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
          <span className="inv-panel__dept">Waste root causes</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            no count history yet
          </span>
        </header>
      </section>
    )
  }

  const summaryEntries = PRIORITY_ORDER.filter(
    (label) => data.summary[label] > 0,
  )

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">
          Waste root causes ·{" "}
          {Math.round(
            (data.windowEnd.getTime() - data.windowStart.getTime()) / 86_400_000,
          )}
          d window
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          ranked by annualized $ exposure
        </span>
      </header>

      <div className="px-5 py-3 border-t border-[var(--hairline)] flex flex-wrap gap-x-4 gap-y-1">
        {summaryEntries.map((label) => (
          <span
            key={label}
            className={`font-mono text-[11px] uppercase tracking-[0.16em] ${LABEL_CLASS[label]}`}
          >
            {LABEL_PROSE[label]} · {data.summary[label]}
          </span>
        ))}
      </div>

      <div>
        <div className="grid grid-cols-[1.6fr_140px_90px_100px_120px_80px] gap-4 px-5 py-2 border-t border-[var(--hairline)] font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          <span>Ingredient</span>
          <span>Pattern</span>
          <span className="text-right">Counts</span>
          <span className="text-right">Mean Δ %</span>
          <span className="text-right">Annual exposure</span>
          <span className="text-right">Adjusts</span>
        </div>
        {data.rows.map((r) => (
          <div
            key={`${r.storeId}::${r.canonicalIngredientId}`}
            className="grid grid-cols-[1.6fr_140px_90px_100px_120px_80px] gap-4 items-center px-5 py-2 border-t border-[var(--hairline)] hover:bg-[rgba(220,38,38,0.045)] transition-colors"
            title={r.classification.rationale}
          >
            <div className="text-[14px] text-[var(--ink)] truncate">
              {r.ingredientName}
              <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                {r.defaultUnit}
              </span>
            </div>
            <div
              className={`font-mono text-[11px] uppercase tracking-[0.16em] ${LABEL_CLASS[r.classification.label]}`}
            >
              {LABEL_PROSE[r.classification.label]}
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {r.sampleSize}
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {fmtPct(r.classification.meanResidualPctOfThroughput)}
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {fmtUsd(r.annualizedDollarExposure)}
            </div>
            <div
              className="text-right text-[12px] tabular-nums text-[var(--ink-faint)] font-mono"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {r.classification.expiryAdjustments > 0 ||
              r.classification.theftAdjustments > 0
                ? `E${r.classification.expiryAdjustments} · T${r.classification.theftAdjustments}`
                : "—"}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
