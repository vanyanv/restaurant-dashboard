"use client"

import type {
  VendorReliabilityBand,
  VendorReliabilityData,
} from "@/app/actions/forecasts/vendor-reliability-actions"

interface Props {
  data: VendorReliabilityData
}

const BAND_LABEL: Record<VendorReliabilityBand, string> = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
  insufficient_data: "—",
}

const BAND_CLASS: Record<VendorReliabilityBand, string> = {
  high: "text-[var(--ink)] font-semibold",
  medium: "text-[var(--ink)]",
  low: "text-[var(--accent)] font-semibold",
  insufficient_data: "text-[var(--ink-faint)]",
}

function fmtUsd(n: number, max = 0) {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: max,
  })
}

function fmtNum(n: number | null, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function fmtPct(n: number | null, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—"
  return `${(n * 100).toFixed(digits)}%`
}

export function VendorReliabilityCard({ data }: Props) {
  if (data.rows.length === 0) {
    return (
      <section className="inv-panel">
        <header className="inv-panel__head px-5 pt-4 pb-2 flex items-baseline justify-between">
          <span className="inv-panel__dept">Vendor reliability</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            no invoices in window
          </span>
        </header>
      </section>
    )
  }

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">
          Vendor reliability ·{" "}
          {Math.round(
            (data.windowEnd.getTime() - data.windowStart.getTime()) / 86_400_000,
          )}
          d window
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          ranked by spend
        </span>
      </header>
      <div>
        <div className="grid grid-cols-[1.4fr_120px_100px_100px_120px_100px_100px] gap-4 px-5 py-2 border-t border-[var(--hairline)] font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          <span>Vendor</span>
          <span className="text-right">Spend (180d)</span>
          <span className="text-right">Invoices</span>
          <span className="text-right">Lead CV</span>
          <span className="text-right">Price volatility</span>
          <span className="text-right">Score</span>
          <span className="text-right">Band</span>
        </div>
        {data.rows.map((r) => (
          <div
            key={r.vendorNameNormalized}
            className="grid grid-cols-[1.4fr_120px_100px_100px_120px_100px_100px] gap-4 items-center px-5 py-2 border-t border-[var(--hairline)] hover:bg-[var(--row-hover-bg)] transition-colors"
          >
            <div className="text-[14px] text-[var(--ink)] truncate" title={r.vendorName}>
              {r.vendorName}
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {fmtUsd(r.spend6mo)}
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {r.invoiceCount}
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              title={
                r.meanLeadDays != null
                  ? `every ${fmtNum(r.meanLeadDays)} days ± ${fmtNum(r.leadDayStd)}`
                  : ""
              }
            >
              {fmtPct(r.leadCV)}
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {fmtPct(r.priceVolatility)}
            </div>
            <div
              className="text-right text-[14px] tabular-nums text-[var(--ink)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {Math.round(r.reliabilityScore)}
            </div>
            <div
              className={`text-right font-mono text-[10px] uppercase tracking-[0.18em] ${BAND_CLASS[r.band]}`}
            >
              {BAND_LABEL[r.band]}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
