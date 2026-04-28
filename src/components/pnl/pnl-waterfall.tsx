import { cn } from "@/lib/utils"

/**
 * Horizontal waterfall: "where the money goes" from Gross Sales down to
 * Bottom Line. Each column either starts from zero (a total/summary bar) or
 * drops from the running total (a subtraction). Rendered with CSS grid +
 * absolutely-positioned bars — SVG would fight our typography system.
 */
export type WaterfallStep =
  | { kind: "total"; label: string; value: number }
  | { kind: "subtract"; label: string; value: number }

export interface PnLWaterfallProps {
  /** Oldest → newest. First step should be `total` (e.g. Gross), last step
   *  should also be `total` (e.g. Bottom Line). Middle steps are `subtract`. */
  steps: WaterfallStep[]
  className?: string
}

function formatDollar(v: number): string {
  if (!Number.isFinite(v)) return "—"
  const abs = Math.abs(v)
  const str = abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return v < 0 ? `−$${str}` : `$${str}`
}

export function PnLWaterfall({ steps, className }: PnLWaterfallProps) {
  if (!steps.length) return null

  // Running total as each step lands. For `total` kind, the value IS the
  // running total after this step; for `subtract`, the running total drops.
  const running: number[] = []
  let cursor = 0
  for (const s of steps) {
    if (s.kind === "total") {
      cursor = s.value
    } else {
      cursor = cursor - Math.abs(s.value)
    }
    running.push(cursor)
  }

  // Scale spans from `floor` (min — may be below zero when fixed costs exceed
  // revenue in a small window, e.g. a single day vs monthly rent) to `peak`
  // (max — the tallest total or pre-subtract running value). Including 0 in
  // both bounds guarantees the zero baseline is always visible.
  const rawPeak = Math.max(
    0,
    ...steps.map((s, i) => (s.kind === "total" ? s.value : running[i - 1] ?? 0))
  )
  const rawFloor = Math.min(
    0,
    ...steps.map((s, i) => (s.kind === "total" ? s.value : running[i] ?? 0))
  )
  const range = rawPeak - rawFloor || 1
  // Convert a dollar value to a "distance from top" percentage.
  const toTopPct = (v: number) => ((rawPeak - v) / range) * 100
  const zeroTopPct = toTopPct(0)

  const grossValue = steps[0].kind === "total" ? steps[0].value : 0
  const bottomValue = steps[steps.length - 1].kind === "total" ? steps[steps.length - 1].value : running[running.length - 1]

  return (
    <section className={cn("pnl-waterfall", className)} aria-label="P&L waterfall">
      <div className="pnl-waterfall__header">
        <span className="editorial-section-label">Where the money goes</span>
        <span className="pnl-waterfall__summary font-mono">
          {formatDollar(grossValue)} <span className="pnl-waterfall__summaryArrow">→</span>{" "}
          <strong>{formatDollar(bottomValue)}</strong>
        </span>
      </div>

      <div className="pnl-waterfall__chart" role="group">
        {steps.map((s, i) => {
          const runAfter = running[i]
          const runBefore = i === 0 ? 0 : running[i - 1]

          let barTopPct: number
          let barBottomPct: number
          if (s.kind === "total") {
            // Bar from zero baseline to the total value (either direction).
            const valTop = toTopPct(s.value)
            barTopPct = Math.min(valTop, zeroTopPct)
            barBottomPct = Math.max(valTop, zeroTopPct)
          } else {
            // Subtract: bar spans from previous running total to new running total.
            const before = toTopPct(runBefore)
            const after = toTopPct(runAfter)
            barTopPct = Math.min(before, after)
            barBottomPct = Math.max(before, after)
          }

          const heightPct = Math.max(1, barBottomPct - barTopPct)
          const barStyle = {
            ["--bar-top" as string]: `${barTopPct}%`,
            ["--bar-scale" as string]: heightPct / 100,
          }

          const tone = s.kind === "total" ? "total" : "subtract"
          const isLast = i === steps.length - 1
          const isNegativeTotal = s.kind === "total" && s.value < 0

          // Connector tick between columns, at the running total line
          const connectorStyle = i < steps.length - 1 ? {
            top: `${toTopPct(runAfter)}%`,
          } : undefined

          return (
            <div
              key={`${s.label}-${i}`}
              className={cn(
                "pnl-waterfall__col",
                `pnl-waterfall__col--${tone}`,
                isLast && "pnl-waterfall__col--finish",
                isNegativeTotal && "pnl-waterfall__col--negative",
                `dock-in dock-in-${Math.min(i + 1, 12)}`
              )}
            >
              <div className="pnl-waterfall__amount font-mono">
                {s.kind === "subtract" ? "−" : ""}
                {formatDollar(Math.abs(s.value)).replace(/^−/, "")}
              </div>
              <div className="pnl-waterfall__plot" aria-hidden>
                {rawFloor < 0 ? (
                  <div
                    className="pnl-waterfall__zero"
                    style={{ top: `${zeroTopPct}%` }}
                  />
                ) : null}
                <div className="pnl-waterfall__bar" style={barStyle} />
                {connectorStyle ? (
                  <div className="pnl-waterfall__connector" style={connectorStyle} />
                ) : null}
              </div>
              <div className="pnl-waterfall__label">{s.label}</div>
              {grossValue > 0 ? (
                <div className="pnl-waterfall__pct">
                  {s.kind === "subtract" ? "−" : ""}
                  {((Math.abs(s.value) / grossValue) * 100).toFixed(1)}%
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
