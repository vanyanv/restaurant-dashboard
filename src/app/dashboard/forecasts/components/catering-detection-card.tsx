"use client"

import type { CateringData } from "@/app/actions/forecasts/catering-detection-actions"

const PLATFORM_LABEL: Record<string, string> = {
  "css-pos": "First-party",
  "bnm-web": "Web",
  doordash: "DoorDash",
  ubereats: "UberEats",
  grubhub: "Grubhub",
}

const TRIGGER_LABEL: Record<string, string> = {
  subtotal_multiplier: "× median",
  subtotal_absolute: "$ floor",
  item_quantity: "qty",
}

function fmtUsd(n: number, max = 0) {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: max,
  })
}

function fmtDateTime(d: Date) {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  })
}

export function CateringDetectionCard({ data }: { data: CateringData }) {
  if (data.orders.length === 0) {
    return (
      <section className="inv-panel">
        <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
          <span className="inv-panel__dept">Catering / bulk orders</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            no outliers in window
          </span>
        </header>
      </section>
    )
  }

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">
          Catering / bulk orders · {data.orders.length} flagged
        </span>
        <span
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] tabular-nums"
          style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
        >
          {fmtUsd(data.totalCateringRevenue)} total
        </span>
      </header>

      <div>
        <div className="grid grid-cols-[140px_90px_1.4fr_80px_80px_100px_120px] gap-4 px-5 py-2 border-t border-[var(--hairline)] font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          <span>When</span>
          <span>Platform</span>
          <span>Customer</span>
          <span className="text-right">Subtotal</span>
          <span className="text-right">× median</span>
          <span className="text-right">Items</span>
          <span className="text-right">Lead</span>
        </div>
        {data.orders.map((o) => (
          <div
            key={o.orderId}
            className="grid grid-cols-[140px_90px_1.4fr_80px_80px_100px_120px] gap-4 items-center px-5 py-2 border-t border-[var(--hairline)] hover:bg-[rgba(220,38,38,0.045)] transition-colors"
          >
            <div className="font-mono text-[11px] text-[var(--ink-muted)]">
              {fmtDateTime(o.referenceTimeLocal)}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
              {PLATFORM_LABEL[o.platform] ?? o.platform}
            </div>
            <div
              className="text-[14px] text-[var(--ink)] truncate"
              title={o.customerName ?? o.externalDisplayId ?? o.orderId}
            >
              {o.customerName ?? o.externalDisplayId ?? "—"}
              <span className="ml-2 inline-flex gap-1">
                {o.triggers.map((t) => (
                  <span
                    key={t}
                    className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--accent)] border border-[var(--accent)]/40 px-1.5 py-0.5 rounded-[1px]"
                  >
                    {TRIGGER_LABEL[t] ?? t}
                  </span>
                ))}
              </span>
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink)] font-semibold"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {fmtUsd(o.subtotal)}
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              title={`store-platform median ${fmtUsd(o.storePlatformMedianSubtotal)}`}
            >
              {o.subtotalMultiplier > 0
                ? `${o.subtotalMultiplier.toFixed(1)}×`
                : "—"}
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              title={`${o.itemCount} line items`}
            >
              {Math.round(o.itemQuantity)} qty
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {o.leadHours != null ? `${o.leadHours}h` : "—"}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
