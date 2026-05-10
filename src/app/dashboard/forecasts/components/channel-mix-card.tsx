"use client"

import type { ChannelMixData } from "@/app/actions/forecasts/channel-mix-actions"

const PLATFORM_LABEL: Record<string, string> = {
  "css-pos": "First-party",
  "bnm-web": "First-party (Web)",
  doordash: "DoorDash",
  ubereats: "UberEats",
  grubhub: "Grubhub",
}

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

function fmtNum(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

export function ChannelMixCard({ data }: { data: ChannelMixData }) {
  if (data.rows.length === 0) {
    return (
      <section className="inv-panel">
        <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
          <span className="inv-panel__dept">Channel mix</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            no platform data
          </span>
        </header>
      </section>
    )
  }

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">
          Channel mix · blended net {fmtPct(data.blendedNetRatePct)}
        </span>
        <span
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] tabular-nums"
          style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
        >
          {fmtUsd(data.totalGross)} gross · {fmtUsd(data.totalFees)} fees
        </span>
      </header>

      <div>
        <div className="grid grid-cols-[1.4fr_100px_100px_100px_100px_100px] gap-4 px-5 py-2 border-t border-[var(--hairline)] font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          <span>Platform</span>
          <span className="text-right">Gross</span>
          <span className="text-right">Share</span>
          <span className="text-right">Fees</span>
          <span className="text-right">Net rate</span>
          <span className="text-right">Orders</span>
        </div>
        {data.rows.map((r) => (
          <div
            key={r.platform}
            className="grid grid-cols-[1.4fr_100px_100px_100px_100px_100px] gap-4 items-center px-5 py-2 border-t border-[var(--hairline)] hover:bg-[var(--row-hover-bg)] transition-colors"
          >
            <div className="text-[14px] text-[var(--ink)]">
              {PLATFORM_LABEL[r.platform] ?? r.platform}
              {r.isFirstParty && (
                <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                  FP
                </span>
              )}
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {fmtUsd(r.grossSales)}
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {fmtPct(r.shareOfGross, 0)}
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {fmtUsd(r.fees)}
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink)] font-semibold"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {fmtPct(r.netRatePct)}
            </div>
            <div
              className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {fmtNum(r.orderCount)}
            </div>
          </div>
        ))}

        {data.simulation && (
          <div className="px-5 py-3 border-t border-[var(--hairline-bold)] bg-[rgba(220,38,38,0.025)]">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] mb-1">
              Shift simulation · {(data.simulation.shiftPct * 100).toFixed(0)}%
            </div>
            <div className="text-[13px] text-[var(--ink)]">
              If {fmtUsd(data.simulation.shiftedGross)} of{" "}
              {PLATFORM_LABEL[data.simulation.fromPlatform] ??
                data.simulation.fromPlatform}{" "}
              gross moved to{" "}
              {PLATFORM_LABEL[data.simulation.toPlatform] ??
                data.simulation.toPlatform}
              :{" "}
              <span
                className="font-semibold tabular-nums text-[var(--accent)]"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                +{fmtUsd(data.simulation.incrementalNet)}
              </span>{" "}
              to operator · blended net rises{" "}
              {fmtPct(data.simulation.oldBlendedNetRatePct, 1)} →{" "}
              {fmtPct(data.simulation.newBlendedNetRatePct, 1)}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
