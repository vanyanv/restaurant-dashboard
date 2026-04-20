import { cn } from "@/lib/utils"

/**
 * Small stamp-style pill showing a period-over-period change.
 *
 * Convention: a **positive delta is good** for revenue-like metrics (larger
 * number is better) and **bad** for cost-like metrics (larger is worse).
 * Pass `costSemantics` to flip the color mapping.
 *
 * Rendered as a muted DM Sans stamp with a ±0.3deg rotation — matches the
 * existing `.stamp-*` motifs used on platform badges.
 */
export interface DeltaStampProps {
  current: number
  prior: number | null | undefined
  /** "dollars" renders `+$1,234` / `-$567`; "percent" renders `+12%`. */
  format?: "dollars" | "percent"
  /** When true, a positive delta is bad (e.g. cost rose). Default false. */
  costSemantics?: boolean
  /** Optional suffix like " vs last month" — rendered in muted tone. */
  suffix?: string
  size?: "sm" | "md"
  className?: string
}

function formatDelta(diff: number, format: "dollars" | "percent"): string {
  const abs = Math.abs(diff)
  if (format === "dollars") {
    const rounded = abs >= 100 ? Math.round(abs) : Math.round(abs * 10) / 10
    const str = rounded.toLocaleString("en-US", { maximumFractionDigits: rounded >= 100 ? 0 : 1 })
    return diff >= 0 ? `+$${str}` : `−$${str}`
  }
  const pct = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1)
  return diff >= 0 ? `+${pct}%` : `−${pct}%`
}

export function DeltaStamp({
  current,
  prior,
  format = "dollars",
  costSemantics = false,
  suffix,
  size = "md",
  className,
}: DeltaStampProps) {
  if (prior == null || !Number.isFinite(prior)) {
    return (
      <span
        className={cn("delta-stamp delta-stamp--idle", size === "sm" && "delta-stamp--sm", className)}
      >
        —
      </span>
    )
  }

  const diff = format === "percent"
    ? (prior === 0 ? 0 : ((current - prior) / Math.abs(prior)) * 100)
    : current - prior
  const positive = diff > 0.0001
  const negative = diff < -0.0001
  // "Good" means the bar looks green. Revenue up = good; cost up = bad.
  const good = costSemantics ? negative : positive
  const bad = costSemantics ? positive : negative

  const tone = good ? "delta-stamp--up" : bad ? "delta-stamp--down" : "delta-stamp--flat"
  const arrow = positive ? "▲" : negative ? "▼" : "→"

  return (
    <span
      className={cn("delta-stamp", tone, size === "sm" && "delta-stamp--sm", className)}
      aria-label={`Change ${formatDelta(diff, format)}${suffix ? ` ${suffix}` : ""}`}
    >
      <span className="delta-stamp__arrow" aria-hidden>{arrow}</span>
      <span className="delta-stamp__value">{formatDelta(diff, format)}</span>
      {suffix ? <span className="delta-stamp__suffix">{suffix}</span> : null}
    </span>
  )
}
