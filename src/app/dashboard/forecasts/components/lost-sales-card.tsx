"use client"

import { format } from "date-fns"
import type { LostSalesData } from "@/app/actions/forecasts/lost-sales-actions"

interface Props {
  data: LostSalesData
}

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

export function LostSalesCard({ data }: Props) {
  if (data.events.length === 0) {
    return (
      <section className="inv-panel">
        <header className="inv-panel__head px-5 pt-4 pb-2 flex items-baseline justify-between">
          <span className="inv-panel__dept">Lost sales · 86&apos;d windows</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            no stock-outs detected
          </span>
        </header>
        <div className="px-5 py-6 text-[var(--ink-muted)]">
          No items dropped to zero after a stable baseline in the last{" "}
          {Math.round(
            (data.windowEnd.getTime() - data.windowStart.getTime()) / 86_400_000,
          )}{" "}
          days. The detector flags items whose pre-gap baseline was strong
          (≥ 3 units/day) and whose gap was ≥ 2 days.
        </div>
      </section>
    )
  }

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">Lost sales · 86&apos;d windows</span>
        <div className="flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          <span>
            {data.events.length} event{data.events.length === 1 ? "" : "s"}
          </span>
          <span>·</span>
          <span>
            est. lost ·{" "}
            <span className="normal-case tracking-normal text-[var(--accent)] font-semibold">
              {fmtUsd(data.totalEstimatedLost)}
            </span>
          </span>
        </div>
      </header>

      <div>
        <div className="grid grid-cols-[1.4fr_120px_120px_100px_140px] gap-4 px-5 py-2 border-t border-[var(--hairline)] font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          <span>Item</span>
          <span className="text-right">Baseline / day</span>
          <span className="text-right">Unit price</span>
          <span className="text-right">Gap days</span>
          <span className="text-right">Est. lost</span>
        </div>
        {data.events.slice(0, 30).map((e) => (
          <div
            key={`${e.storeId}|${e.itemName}|${e.gapStart.toISOString()}`}
            className="grid grid-cols-[1.4fr_120px_120px_100px_140px] gap-4 items-center px-5 py-2 border-t border-[var(--hairline)] hover:bg-[var(--row-hover-bg)] transition-colors"
          >
            <div>
              <div className="text-[14px] text-[var(--ink)] truncate" title={e.itemName}>
                {e.itemName}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                {e.storeName ? `${e.storeName} · ` : ""}
                {format(e.gapStart, "MMM d")} – {format(e.gapEnd, "MMM d")}
              </div>
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {fmtNum(e.baselineDailyQty, 1)}
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {fmtUsd(e.meanUnitPrice, 2)}
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {e.gapDays}
            </div>
            <div
              className="text-right text-[14px] tabular-nums text-[var(--accent)] font-semibold"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {fmtUsd(e.estimatedLostRevenue)}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
