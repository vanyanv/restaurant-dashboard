import { cn } from "@/lib/utils"
import type { Period } from "@/lib/pnl"
import { DeltaStamp } from "./delta-stamp"

/**
 * Hero paragraph — the single-glance answer to "am I making money?". Written
 * for a human operator: subject + verb + number, not "Metric: $X".
 *
 * Fraunces italic display; red accent on the dollar figure; muted kicker above
 * and delta-stamp row below.
 */
export interface PnLLedeProps {
  storeName: string
  /** Array of per-period bottom-line values (aligned with `periods`). */
  bottomLineByPeriod: number[]
  /** Total-sales series, same alignment. Used for margin context. */
  grossByPeriod: number[]
  periods: Period[]
  className?: string
}

function formatDollar(v: number): string {
  if (!Number.isFinite(v)) return "—"
  const abs = Math.abs(v)
  const str = abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return v < 0 ? `−$${str}` : `$${str}`
}

function periodKicker(p: Period): string {
  if (!p) return ""
  if (p.days <= 1) return "on"
  if (p.days <= 7) return "the week of"
  if (p.days <= 31) return "in"
  return "across"
}

export function PnLLede({
  storeName,
  bottomLineByPeriod,
  grossByPeriod,
  periods,
  className,
}: PnLLedeProps) {
  if (periods.length === 0) return null

  const latestIdx = periods.length - 1
  const priorIdx = periods.length >= 2 ? latestIdx - 1 : null
  const latest = bottomLineByPeriod[latestIdx] ?? 0
  const latestGross = grossByPeriod[latestIdx] ?? 0
  const marginPct = latestGross > 0 ? (latest / latestGross) * 100 : null
  const latestPeriod = periods[latestIdx]

  const positive = latest >= 0
  const kicker = periodKicker(latestPeriod)
  const periodLabel = latestPeriod.label

  return (
    <section className={cn("pnl-lede", className)} aria-label="Period summary">
      <div className="pnl-lede__kicker">
        <span className="editorial-section-label">§ 11 · The Ledger</span>
      </div>
      <h1 className="pnl-lede__headline font-display">
        {storeName} {positive ? "cleared" : "ran a loss of"}{" "}
        <span className="pnl-lede__dollar">{formatDollar(latest)}</span>
        <span className="pnl-lede__tail">
          {" "}{kicker} <em>{periodLabel}</em>.
        </span>
      </h1>
      <div className="pnl-lede__meta">
        {marginPct != null ? (
          <span className="pnl-lede__margin">
            <span className="pnl-lede__metaKey">Margin</span>
            <span className="pnl-lede__metaValue">
              {marginPct >= 0 ? "" : "−"}{Math.abs(marginPct).toFixed(1)}%
            </span>
          </span>
        ) : null}
        <span className="pnl-lede__margin">
          <span className="pnl-lede__metaKey">Gross</span>
          <span className="pnl-lede__metaValue font-mono">
            {formatDollar(latestGross)}
          </span>
        </span>
        {priorIdx != null ? (
          <DeltaStamp
            current={latest}
            prior={bottomLineByPeriod[priorIdx]}
            format="dollars"
            suffix={`vs ${periods[priorIdx].label}`}
          />
        ) : null}
      </div>
    </section>
  )
}
