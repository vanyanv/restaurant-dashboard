"use client"

import { format } from "date-fns"
import type { FoodCostForecastData } from "@/app/actions/forecasts/food-cost-forecast-actions"

interface Props {
  data: FoodCostForecastData
  /** Per-store target COGS % from Store.targetCogsPct (decimal). Optional. */
  targetPct?: number | null
}

function fmtUsd(n: number | null, max = 0) {
  if (n == null || !Number.isFinite(n)) return "—"
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

export function FoodCostForecastCard({ data, targetPct }: Props) {
  if (data.days.length === 0) {
    return (
      <section className="inv-panel">
        <header className="inv-panel__head px-5 pt-4 pb-2 flex items-baseline justify-between">
          <span className="inv-panel__dept">Food cost % · forward</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            awaiting forecast
          </span>
        </header>
        <div className="px-5 py-6 text-[var(--ink-muted)]">
          Need both a revenue forecast and a menu-item forecast for {data.storeName}.
          Appears once the nightly pipeline has populated both.
        </div>
      </section>
    )
  }

  const blended = data.blendedFoodCostPct
  const overTarget =
    blended != null && targetPct != null && blended > targetPct
  const horizonDays = data.days.length

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">Food cost % · forward {horizonDays}d</span>
        <div className="flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          {targetPct != null && (
            <>
              <span>
                target ·{" "}
                <span className="normal-case tracking-normal">{fmtPct(targetPct)}</span>
              </span>
              <span>·</span>
            </>
          )}
          {data.generatedAt ? (
            <span>run · {format(data.generatedAt, "MMM d, HH:mm")}</span>
          ) : (
            <span>partial — revenue forecast missing</span>
          )}
        </div>
      </header>

      <div className="px-5 pb-2 grid grid-cols-3 gap-6">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            Predicted revenue
          </div>
          <div
            className="text-[24px] tabular-nums text-[var(--ink)]"
            style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
          >
            {fmtUsd(data.totalPredictedRevenue)}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            Predicted food cost
          </div>
          <div
            className="text-[24px] tabular-nums text-[var(--ink)]"
            style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
          >
            {fmtUsd(data.totalPredictedFoodCost)}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            Blended food cost %
          </div>
          <div
            className={`text-[28px] tabular-nums ${
              overTarget ? "text-[var(--accent)] font-semibold" : "text-[var(--ink)]"
            }`}
            style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
          >
            {fmtPct(blended)}
          </div>
        </div>
      </div>

      <div>
        <div className="grid grid-cols-[100px_120px_120px_120px_120px] gap-4 px-5 py-2 border-t border-[var(--hairline)] font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          <span>Date</span>
          <span className="text-right">Revenue</span>
          <span className="text-right">Food cost</span>
          <span className="text-right">FC %</span>
          <span className="text-right">Worst case</span>
        </div>
        {data.days.map((d) => {
          const overDayTarget =
            d.foodCostPct != null && targetPct != null && d.foodCostPct > targetPct
          return (
            <div
              key={d.date.toISOString()}
              className="grid grid-cols-[100px_120px_120px_120px_120px] gap-4 items-center px-5 py-2 border-t border-[var(--hairline)] hover:bg-[var(--row-hover-bg)] transition-colors"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                {format(d.date, "EEE M/d")}
              </div>
              <div
                className="text-right text-[13px] tabular-nums text-[var(--ink)]"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {fmtUsd(d.predictedRevenue)}
              </div>
              <div
                className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {fmtUsd(d.predictedFoodCost)}
              </div>
              <div
                className={`text-right text-[13px] tabular-nums ${
                  overDayTarget ? "text-[var(--accent)] font-semibold" : "text-[var(--ink)]"
                }`}
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {fmtPct(d.foodCostPct)}
              </div>
              <div
                className="text-right font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {fmtPct(d.pctP90)}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
