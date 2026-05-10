"use client"

import type { PromoRoiData } from "@/app/actions/forecasts/promo-roi-actions"

const WEEKDAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function fmtUsd(n: number, max = 0) {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: max,
  })
}

function fmtPct(n: number | null, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—"
  return `${(n * 100).toFixed(digits)}%`
}

function fmtRoi(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—"
  return `${n.toFixed(2)}×`
}

function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

export function PromoRoiCard({ data }: { data: PromoRoiData }) {
  if (data.events.length === 0) {
    return (
      <section className="inv-panel">
        <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
          <span className="inv-panel__dept">Promotion ROI</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            no elevated-discount days detected
          </span>
        </header>
      </section>
    )
  }

  const days = Math.round(
    (data.windowEnd.getTime() - data.windowStart.getTime()) / 86_400_000,
  )

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">Promotion ROI · {days}d window</span>
        <span
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] tabular-nums"
          style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
        >
          blended {fmtRoi(data.blendedRoi)} ·{" "}
          {fmtUsd(data.totalLift)} lift / {fmtUsd(data.totalDiscount)}{" "}
          discounted
        </span>
      </header>

      <div>
        <div className="grid grid-cols-[110px_60px_120px_120px_120px_100px_80px] gap-4 px-5 py-2 border-t border-[var(--hairline)] font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          <span>Date</span>
          <span>Day</span>
          <span className="text-right">Net sales</span>
          <span className="text-right">Baseline</span>
          <span className="text-right">Lift (80% CI)</span>
          <span className="text-right">Discount</span>
          <span className="text-right">ROI</span>
        </div>
        {data.events.map((e) => {
          const liftClass =
            e.lift >= 0
              ? "text-[var(--ink)]"
              : "text-[var(--accent)] font-semibold"
          return (
            <div
              key={e.date.toISOString()}
              className="grid grid-cols-[110px_60px_120px_120px_120px_100px_80px] gap-4 items-center px-5 py-2 border-t border-[var(--hairline)] hover:bg-[var(--row-hover-bg)] transition-colors"
            >
              <div className="text-[13px] text-[var(--ink)] font-mono">
                {fmtDate(e.date)}
              </div>
              <div className="text-[12px] text-[var(--ink-muted)] font-mono uppercase">
                {WEEKDAY_LABEL[e.weekday]}
              </div>
              <div
                className="text-right text-[13px] tabular-nums text-[var(--ink)]"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {fmtUsd(e.netSales)}
              </div>
              <div
                className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                title={`baseline n=${e.baselineSampleSize}, σ=${fmtUsd(e.baselineStd)}`}
              >
                {fmtUsd(e.baselineNetSales)}
              </div>
              <div
                className={`text-right text-[13px] tabular-nums ${liftClass}`}
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                title={`80% CI [${fmtUsd(e.liftCI80Low)}, ${fmtUsd(e.liftCI80High)}]`}
              >
                {fmtUsd(e.lift)}
              </div>
              <div
                className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                title={`${fmtPct(e.discountPct)} of gross`}
              >
                {fmtUsd(e.discount)}
              </div>
              <div
                className="text-right text-[13px] tabular-nums text-[var(--ink)] font-semibold"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {fmtRoi(e.roi)}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
