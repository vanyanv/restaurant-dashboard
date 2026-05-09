"use client"

import type { MenuItemForecastData } from "@/app/actions/forecasts/menu-item-forecast-actions"

interface Props {
  data: MenuItemForecastData
}

function fmtQty(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function fmtPct(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—"
  return `${(n * 100).toFixed(1)}%`
}

export function MenuItemForecastTable({ data }: Props) {
  if (data.items.length === 0) {
    return (
      <section className="inv-panel">
        <header className="inv-panel__head px-5 pt-4 pb-2 flex items-baseline justify-between">
          <span className="inv-panel__dept">Menu item demand · 7 days</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            awaiting first run
          </span>
        </header>
        <div className="px-5 py-6 text-[var(--ink-muted)]">
          The pipeline has not produced menu-item forecasts for {data.storeName} yet.
        </div>
      </section>
    )
  }

  const horizonDays = data.items[0]?.days.length ?? 0

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">Menu item demand · {horizonDays} days</span>
        <div className="flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          <span>{data.items.length} items</span>
          <span>·</span>
          <span>
            mape ·{" "}
            <span className="normal-case tracking-normal">{fmtPct(data.recentMape)}</span>
          </span>
        </div>
      </header>

      <div>
        <div className="grid grid-cols-[1.4fr_120px_120px_120px] gap-4 px-5 py-2 border-t border-[var(--hairline)] font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          <span>Item</span>
          <span className="text-right">Total {horizonDays}d</span>
          <span className="text-right">Daily avg</span>
          <span className="text-right">P10–P90</span>
        </div>
        {data.items.slice(0, 30).map((item) => {
          const dailyAvg = item.totalPredicted / Math.max(1, item.days.length)
          const totalLow = item.days.reduce((s, d) => s + (d.p10 ?? d.predictedQty), 0)
          const totalHigh = item.days.reduce((s, d) => s + (d.p90 ?? d.predictedQty), 0)
          return (
            <div
              key={item.otterItemSkuId}
              className="grid grid-cols-[1.4fr_120px_120px_120px] gap-4 items-center px-5 py-2 border-t border-[var(--hairline)] hover:bg-[rgba(220,38,38,0.045)] transition-colors"
            >
              <div className="text-[14px] text-[var(--ink)] truncate" title={item.otterItemSkuId}>
                {item.otterItemSkuId}
              </div>
              <div
                className="text-right text-[14px] tabular-nums text-[var(--ink)]"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {fmtQty(item.totalPredicted)}
              </div>
              <div
                className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {fmtQty(dailyAvg)}
              </div>
              <div
                className="text-right font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {fmtQty(totalLow)}–{fmtQty(totalHigh)}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
