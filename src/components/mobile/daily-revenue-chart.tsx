import type { DailyTrend } from "@/types/analytics"

type Props = {
  data: DailyTrend[]
  /** Header eyebrow label, e.g. "DAILY REVENUE · LAST 14D". */
  label?: string
  /** Show the dotted gross-revenue outline behind each net bar. */
  showGross?: boolean
}

const fmtMoneyShort = (n: number) => {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${Math.round(n)}`
}

const fmtDateTick = (iso: string) => {
  // iso is YYYY-MM-DD; render as "M/D" without timezone churn.
  const [, m, d] = iso.split("-")
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`
}

const fmtDateFull = (iso: string) => {
  const d = new Date(iso + "T12:00:00Z")
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

/**
 * Mobile-native daily revenue bar chart. Same SVG-only approach as
 * `HourlyChart` so the editorial tokens (hairlines, ink, tabular figures)
 * apply directly and we avoid Recharts' SaaS chrome on small screens.
 */
export function DailyRevenueChart({
  data,
  label = "DAILY REVENUE",
  showGross = true,
}: Props) {
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date))
  const days = sorted.length

  const totalNet = sorted.reduce((s, r) => s + r.netRevenue, 0)
  const totalGross = sorted.reduce((s, r) => s + r.grossRevenue, 0)

  // Peak by net revenue.
  let peakIdx = 0
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].netRevenue > sorted[peakIdx].netRevenue) peakIdx = i
  }
  const peakDate = sorted[peakIdx]?.date ?? null

  const max = Math.max(
    1,
    ...sorted.flatMap((r) => [
      r.netRevenue,
      showGross ? r.grossRevenue : 0,
    ])
  )

  // Layout — mirrors HourlyChart for visual cohesion.
  const W = 358
  const H = 200
  const padTop = 18
  const padBottom = 22
  const padLeft = 8
  const padRight = 8
  const innerW = W - padLeft - padRight
  const innerH = H - padTop - padBottom
  const colW = days > 0 ? innerW / days : innerW
  const barW = Math.max(4, colW * 0.62)

  // Tick density — with 14 days, every other day. With 7, every day.
  const tickEvery = days > 10 ? 2 : 1

  return (
    <div className="dock-in dock-in-3" style={{ position: "relative" }}>
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
          {label}
          {peakDate
            ? ` · PEAK ${fmtDateTick(peakDate).toUpperCase()}`
            : ""}
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
          {showGross && totalGross > 0
            ? `${fmtMoneyShort(totalNet)} net · ${fmtMoneyShort(totalGross)} gross`
            : `${fmtMoneyShort(totalNet)} net`}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Daily revenue chart"
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

        {sorted.map((row, i) => {
          const cx = padLeft + colW * i + colW / 2
          const isPeak = i === peakIdx && row.netRevenue > 0
          const netH = Math.max(0, (row.netRevenue / max) * innerH)
          const grossH = showGross
            ? Math.max(0, (row.grossRevenue / max) * innerH)
            : 0
          const x = cx - barW / 2
          const baseY = H - padBottom

          return (
            <g key={row.date}>
              {showGross && row.grossRevenue > 0 ? (
                <rect
                  x={x}
                  y={baseY - grossH}
                  width={barW}
                  height={grossH}
                  fill="none"
                  stroke="var(--ink-faint)"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  opacity={0.55}
                >
                  <title>
                    {`${fmtDateFull(row.date)} — gross ${fmtMoneyShort(row.grossRevenue)}`}
                  </title>
                </rect>
              ) : null}
              {row.netRevenue > 0 ? (
                <rect
                  className="m-chart-bar"
                  style={{ "--i": i } as React.CSSProperties}
                  x={x}
                  y={baseY - netH}
                  width={barW}
                  height={netH}
                  fill={isPeak ? "var(--accent)" : "var(--ink)"}
                  fillOpacity={isPeak ? 1 : 0.86}
                >
                  <title>
                    {`${fmtDateFull(row.date)} — net ${fmtMoneyShort(row.netRevenue)}`}
                  </title>
                </rect>
              ) : null}
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
                  {fmtDateTick(row.date)}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
