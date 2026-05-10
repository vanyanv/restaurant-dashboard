"use client"

import type { LaunchTrajectoryData } from "@/app/actions/forecasts/launch-trajectory-actions"

function fmtUsd(n: number, max = 0) {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: max,
  })
}

function fmtNum(n: number, digits = 0) {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const max = Math.max(...values, 1)
  const w = 80
  const h = 18
  const step = w / (values.length - 1)
  const points = values
    .map((v, i) => `${(i * step).toFixed(2)},${(h - (v / max) * h).toFixed(2)}`)
    .join(" ")
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="inline-block align-middle"
      aria-hidden
    >
      <polyline
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.25"
        points={points}
      />
    </svg>
  )
}

export function LaunchTrajectoryCard({ data }: { data: LaunchTrajectoryData }) {
  if (data.launches.length === 0) {
    return (
      <section className="inv-panel">
        <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
          <span className="inv-panel__dept">Launch trajectory</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            no new items detected in window
          </span>
        </header>
      </section>
    )
  }

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">
          Launch trajectory · {data.launches.length} new item
          {data.launches.length === 1 ? "" : "s"}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          ranked by revenue · 90d projection
        </span>
      </header>

      <div>
        <div className="grid grid-cols-[1.6fr_90px_70px_100px_90px_140px_90px] gap-4 px-5 py-2 border-t border-[var(--hairline)] font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          <span>Item</span>
          <span>First sale</span>
          <span className="text-right">Days</span>
          <span className="text-right">Revenue</span>
          <span className="text-right">Total qty</span>
          <span className="text-right">Trend (qty/day)</span>
          <span className="text-right">90d proj.</span>
        </div>
        {data.launches.map((l) => {
          const series = l.daily.map((d) => d.qty)
          return (
            <div
              key={`${l.storeId}-${l.category}-${l.itemName}`}
              className="grid grid-cols-[1.6fr_90px_70px_100px_90px_140px_90px] gap-4 items-center px-5 py-2 border-t border-[var(--hairline)] hover:bg-[var(--row-hover-bg)] transition-colors"
            >
              <div
                className="text-[14px] text-[var(--ink)] truncate"
                title={`${l.category} · ${l.itemName}`}
              >
                {l.itemName}
                <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                  {l.category}
                  {l.storeName ? ` · ${l.storeName}` : ""}
                </span>
              </div>
              <div className="font-mono text-[11px] text-[var(--ink-muted)]">
                {fmtDate(l.firstSaleDate)}
              </div>
              <div
                className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {l.daysSinceLaunch}d
              </div>
              <div
                className="text-right text-[13px] tabular-nums text-[var(--ink)]"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {fmtUsd(l.totalRevenue)}
              </div>
              <div
                className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {fmtNum(l.totalQty)}
              </div>
              <div className="flex items-center justify-end gap-2">
                <Sparkline values={series} />
                {l.projection ? (
                  <span
                    className="font-mono text-[11px] text-[var(--ink-muted)] tabular-nums"
                    style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                  >
                    {fmtNum(l.projection.meanDailyQtyTrailing7, 1)}/d
                  </span>
                ) : (
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                    early
                  </span>
                )}
              </div>
              <div
                className="text-right text-[13px] tabular-nums text-[var(--ink)] font-semibold"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                title={
                  l.projection
                    ? `80% CI [${fmtNum(l.projection.projectedQtyCI80Low)}, ${fmtNum(l.projection.projectedQtyCI80High)}]`
                    : "needs ≥ 7 days of sales"
                }
              >
                {l.projection ? fmtNum(l.projection.projectedQty90d) : "—"}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
