import type { RevenueForecastDay } from "@/app/actions/forecasts/revenue-forecast-actions"

type Props = {
  days: RevenueForecastDay[]
  /** Header eyebrow label, e.g. "REVENUE FORECAST · 7D". */
  label?: string
}

const fmtMoneyShort = (n: number) => {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${Math.round(n)}`
}

const fmtDateTick = (date: Date) => {
  const m = date.getUTCMonth() + 1
  const d = date.getUTCDate()
  return `${m}/${d}`
}

const fmtDateFull = (date: Date) =>
  date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

/**
 * Mobile-native revenue forecast band chart. SVG-only so editorial tokens apply
 * directly (no Recharts SaaS chrome on a phone). Shaded p10/p90 band beneath
 * the median line. Mirrors the layout grammar of `DailyRevenueChart`.
 */
export function ForecastBandChart({
  days,
  label = "REVENUE FORECAST",
}: Props) {
  if (days.length === 0) {
    return (
      <div className="m-chart-frame dock-in dock-in-3">
        <div className="m-empty m-empty--flush">
          The nightly ML pipeline has not produced a forecast yet.
        </div>
      </div>
    )
  }

  const totalPredicted = days.reduce((s, d) => s + d.predictedRevenue, 0)
  const dailyAvg = totalPredicted / days.length

  // Peak by predicted revenue.
  let peakIdx = 0
  for (let i = 1; i < days.length; i++) {
    if (days[i].predictedRevenue > days[peakIdx].predictedRevenue) peakIdx = i
  }

  const max = Math.max(
    1,
    ...days.flatMap((d) => [
      d.predictedRevenue,
      d.p90 ?? d.predictedRevenue,
    ]),
  )

  // Layout — mirrors DailyRevenueChart for visual cohesion.
  const W = 358
  const H = 200
  const padTop = 18
  const padBottom = 22
  const padLeft = 8
  const padRight = 8
  const innerW = W - padLeft - padRight
  const innerH = H - padTop - padBottom
  const colW = innerW / days.length

  // Map a value into svg-y space, with a small floor so a 0 still has a tick.
  const yFor = (v: number) => padTop + (1 - v / max) * innerH

  // Build polyline / band paths in one pass.
  const linePoints: string[] = []
  const bandTopPoints: string[] = []
  const bandBottomPoints: string[] = []
  for (let i = 0; i < days.length; i++) {
    const cx = padLeft + colW * i + colW / 2
    const d = days[i]
    linePoints.push(`${cx.toFixed(1)},${yFor(d.predictedRevenue).toFixed(1)}`)
    if (d.p10 != null && d.p90 != null) {
      bandTopPoints.push(`${cx.toFixed(1)},${yFor(d.p90).toFixed(1)}`)
      bandBottomPoints.push(`${cx.toFixed(1)},${yFor(d.p10).toFixed(1)}`)
    }
  }
  const hasBand = bandTopPoints.length === days.length
  const bandPath = hasBand
    ? `M ${bandTopPoints.join(" L ")} L ${bandBottomPoints
        .slice()
        .reverse()
        .join(" L ")} Z`
    : null

  const tickEvery = days.length > 8 ? 2 : 1

  return (
    <div className="m-chart-frame dock-in dock-in-3" style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          padding: "0 4px 6px",
          gap: 12,
        }}
      >
        <span
          style={{
            fontFamily:
              "var(--font-jetbrains-mono), ui-monospace, monospace",
            fontSize: 9.5,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
          }}
        >
          {label} · PEAK {fmtDateTick(days[peakIdx].date).toUpperCase()}
        </span>
        <span
          style={{
            fontFamily:
              "var(--font-jetbrains-mono), ui-monospace, monospace",
            fontSize: 9.5,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
            fontVariantNumeric: "tabular-nums lining-nums",
          }}
        >
          {fmtMoneyShort(totalPredicted)} total · {fmtMoneyShort(dailyAvg)} avg
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Revenue forecast band chart"
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          background: "rgba(255, 253, 247, 0.72)",
          border: "1px solid var(--hairline-bold)",
          borderRadius: 2,
        }}
      >
        <line
          x1={padLeft}
          x2={W - padRight}
          y1={H - padBottom}
          y2={H - padBottom}
          stroke="var(--hairline-bold)"
          strokeWidth={1}
        />
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={padLeft}
            x2={W - padRight}
            y1={padTop + innerH * (1 - t)}
            y2={padTop + innerH * (1 - t)}
            stroke="var(--hairline)"
            strokeWidth={1}
            strokeDasharray="2 4"
          />
        ))}

        {bandPath ? (
          <path
            d={bandPath}
            fill="var(--accent)"
            fillOpacity={0.08}
            stroke="none"
          />
        ) : null}

        <polyline
          points={linePoints.join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {days.map((d, i) => {
          const cx = padLeft + colW * i + colW / 2
          const cy = yFor(d.predictedRevenue)
          const isPeak = i === peakIdx
          return (
            <g key={d.date.toISOString()}>
              <circle
                cx={cx}
                cy={cy}
                r={isPeak ? 3.5 : 2.5}
                fill="var(--accent)"
                stroke="var(--paper)"
                strokeWidth={isPeak ? 1.5 : 1}
              >
                <title>
                  {`${fmtDateFull(d.date)} — ${fmtMoneyShort(d.predictedRevenue)}${
                    d.p10 != null && d.p90 != null
                      ? ` (${fmtMoneyShort(d.p10)} – ${fmtMoneyShort(d.p90)})`
                      : ""
                  }`}
                </title>
              </circle>
              {i % tickEvery === 0 ? (
                <text
                  x={cx}
                  y={H - padBottom + 12}
                  textAnchor="middle"
                  fontFamily="var(--font-jetbrains-mono), ui-monospace, monospace"
                  fontSize={8.5}
                  letterSpacing={1}
                  fill="var(--ink-faint)"
                >
                  {fmtDateTick(d.date)}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
