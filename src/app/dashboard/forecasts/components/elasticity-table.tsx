"use client"

import type {
  MenuItemElasticityData,
  ElasticityConfidence,
} from "@/app/actions/forecasts/elasticity-actions"

interface Props {
  data: MenuItemElasticityData
}

const CONFIDENCE_LABEL: Record<ElasticityConfidence, string> = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
  no_signal: "NO SIGNAL",
}

const CONFIDENCE_CLASS: Record<ElasticityConfidence, string> = {
  high: "text-[var(--ink)] font-semibold",
  medium: "text-[var(--ink)]",
  low: "text-[var(--ink-muted)]",
  no_signal: "text-[var(--ink-faint)]",
}

function fmt(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function fmtPct(n: number) {
  if (!Number.isFinite(n)) return "—"
  return `${(n * 100).toFixed(1)}%`
}

function fmtUsd(n: number) {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  })
}

export function ElasticityTable({ data }: Props) {
  if (data.rows.length === 0) {
    return (
      <section className="inv-panel">
        <header className="inv-panel__head px-5 pt-4 pb-2 flex items-baseline justify-between">
          <span className="inv-panel__dept">Price elasticity</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            awaiting first fit
          </span>
        </header>
        <div className="px-5 py-6 text-[var(--ink-muted)]">
          The nightly pipeline computes price elasticity per item via
          log(qty) ~ log(price) + weekday-dummy regression. Appears once
          the first run completes.
        </div>
      </section>
    )
  }

  const signalRows = data.rows.filter((r) => r.confidence !== "no_signal")
  const top = signalRows.slice(0, 30)

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">Price elasticity · most elastic first</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          {signalRows.length} of {data.rows.length} items have a usable fit
        </span>
      </header>
      <div>
        <div className="grid grid-cols-[1.4fr_120px_120px_140px_100px] gap-4 px-5 py-2 border-t border-[var(--hairline)] font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          <span>Item</span>
          <span className="text-right">Mean price</span>
          <span className="text-right">Elasticity</span>
          <span className="text-right">10% hike → ΔQ</span>
          <span className="text-right">Confidence</span>
        </div>
        {top.map((r) => (
          <div
            key={r.otterItemSkuId}
            className="grid grid-cols-[1.4fr_120px_120px_140px_100px] gap-4 items-center px-5 py-2 border-t border-[var(--hairline)] hover:bg-[rgba(220,38,38,0.045)] transition-colors"
          >
            <div className="text-[14px] text-[var(--ink)] truncate" title={r.otterItemSkuId}>
              {r.otterItemSkuId}
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {fmtUsd(r.meanPrice)}
            </div>
            <div
              className={`text-right text-[14px] tabular-nums ${
                r.elasticity <= -1.5 ? "text-[var(--accent)]" : "text-[var(--ink)]"
              }`}
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {fmt(r.elasticity)}
            </div>
            <div
              className={`text-right text-[13px] tabular-nums ${
                r.pctVolumeChangeAt10PctHike <= -0.15 ? "text-[var(--accent)]" : "text-[var(--ink-muted)]"
              }`}
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {fmtPct(r.pctVolumeChangeAt10PctHike)}
            </div>
            <div
              className={`text-right font-mono text-[10px] uppercase tracking-[0.18em] ${CONFIDENCE_CLASS[r.confidence]}`}
              title={`fit R² ${(r.fitR2 * 100).toFixed(1)}% · ${r.pricePointCount} price points · n=${r.sampleSize}`}
            >
              {CONFIDENCE_LABEL[r.confidence]}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
