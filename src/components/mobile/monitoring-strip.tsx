type Series = { bucket: Date; value: number }[]

type Props = {
  /** Three parallel hourly series; missing hours within window are zero-filled
   *  by the caller so each is the same length. */
  errors: Series
  aiCost: Series
  logins: Series
  /** Login failures, plotted in accent stroke under the success line. */
  loginFailures: Series
}

const fmtCount = (n: number) => n.toLocaleString("en-US")
const fmtUsd = (n: number) =>
  n >= 1
    ? `$${n.toFixed(2)}`
    : n > 0
      ? `$${n.toFixed(3)}`
      : "$0"

function Mini({
  caption,
  total,
  series,
  dangerSeries,
  totalLabel,
}: {
  caption: string
  total: string
  series: Series
  dangerSeries?: Series
  totalLabel?: string
}) {
  const W = 110
  const H = 44
  const padTop = 4
  const padBottom = 8
  const padLeft = 0
  const padRight = 0
  const innerW = W - padLeft - padRight
  const innerH = H - padTop - padBottom
  const colW = series.length > 0 ? innerW / series.length : innerW
  const max = Math.max(
    1,
    ...series.map((p) => p.value),
    ...(dangerSeries?.map((p) => p.value) ?? [0]),
  )
  return (
    <div className="m-mon-mini">
      <div className="m-mon-mini__caption">{caption}</div>
      <div className="m-mon-mini__total">{total}</div>
      {totalLabel ? (
        <div className="m-mon-mini__totalcap">{totalLabel}</div>
      ) : null}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${caption} sparkline`}
        className="m-mon-mini__svg"
      >
        <line
          x1={padLeft}
          x2={W - padRight}
          y1={H - padBottom}
          y2={H - padBottom}
          stroke="var(--hairline)"
          strokeWidth={1}
        />
        {series.map((p, i) => {
          const x = padLeft + colW * i
          const h = (p.value / max) * innerH
          if (h <= 0) return null
          return (
            <rect
              key={`s-${p.bucket.toISOString()}`}
              x={x + 0.5}
              y={H - padBottom - h}
              width={Math.max(1.5, colW - 1)}
              height={h}
              fill="var(--ink)"
              fillOpacity={0.86}
            />
          )
        })}
        {dangerSeries?.map((p, i) => {
          const x = padLeft + colW * i
          const h = (p.value / max) * innerH
          if (h <= 0) return null
          return (
            <rect
              key={`d-${p.bucket.toISOString()}`}
              x={x + 0.5}
              y={H - padBottom - h}
              width={Math.max(1.5, colW - 1)}
              height={h}
              fill="var(--accent)"
            />
          )
        })}
      </svg>
    </div>
  )
}

/**
 * Three-up mini-chart strip: errors, AI cost, logins. Used at the top of
 * /m/monitoring as a glanceable last-24h pulse. Each cell is a stacked
 * caption + total + 24-hour sparkline of bars in `var(--ink)`.
 */
export function MonitoringActivityStrip({
  errors,
  aiCost,
  logins,
  loginFailures,
}: Props) {
  const totalErrors = errors.reduce((s, p) => s + p.value, 0)
  const totalCost = aiCost.reduce((s, p) => s + p.value, 0)
  const totalLogins = logins.reduce((s, p) => s + p.value, 0)
  const totalFailed = loginFailures.reduce((s, p) => s + p.value, 0)

  return (
    <div className="m-mon-strip">
      <Mini
        caption="ERRORS · 24H"
        total={fmtCount(totalErrors)}
        series={errors}
      />
      <Mini
        caption="AI COST · 24H"
        total={fmtUsd(totalCost)}
        series={aiCost}
      />
      <Mini
        caption="LOGINS · 24H"
        total={fmtCount(totalLogins)}
        totalLabel={totalFailed > 0 ? `${totalFailed} failed` : undefined}
        series={logins}
        dangerSeries={loginFailures}
      />
    </div>
  )
}
