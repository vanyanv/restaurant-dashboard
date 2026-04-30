import type { HourlyOrderPoint } from "@/types/analytics"

type Props = {
  data: HourlyOrderPoint[]
  /** Inclusive hour to start the x-axis at. Defaults to 8 (8am). */
  startHour?: number
  /** Inclusive hour to end the x-axis at. Defaults to 23 (11pm). */
  endHour?: number
  /** When true, draws the avg-of-prior baseline as faint outlined columns
   *  behind each bar. */
  showBaseline?: boolean
  /** Render the value labels above each bar — orderCount or totalSales. */
  metric?: "orders" | "sales"
}

const fmtCount = (n: number) => n.toLocaleString("en-US")
const fmtMoneyShort = (n: number) => {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${Math.round(n)}`
}
const fmtHourLabel = (h: number) => {
  if (h === 0) return "12a"
  if (h === 12) return "12p"
  if (h < 12) return `${h}a`
  return `${h - 12}p`
}

/**
 * Editorial hourly bar chart. Pure SVG — no chart library — so the system
 * tokens (hairlines, ink colors, tabular figures) apply naturally and there
 * is no rounded SaaS chrome to fight.
 */
export function HourlyChart({
  data,
  startHour = 8,
  endHour = 23,
  showBaseline = true,
  metric = "orders",
}: Props) {
  const byHour = new Map(data.map((d) => [d.hour, d]))
  const hours: number[] = []
  for (let h = startHour; h <= endHour; h++) hours.push(h)

  const valueOf = (h: number) => {
    const p = byHour.get(h)
    if (!p) return 0
    return metric === "orders" ? p.orderCount : p.totalSales
  }
  const baselineOf = (h: number) => {
    const p = byHour.get(h)
    if (!p) return 0
    return metric === "orders" ? p.avgOrderCount : p.avgTotalSales
  }

  const max = Math.max(
    1,
    ...hours.flatMap((h) => [valueOf(h), showBaseline ? baselineOf(h) : 0])
  )

  // Find peak hour for the highlighted label
  let peakHour = hours[0]
  for (const h of hours) {
    if (valueOf(h) > valueOf(peakHour)) peakHour = h
  }

  const totalValue = hours.reduce((s, h) => s + valueOf(h), 0)
  const totalBaseline = hours.reduce((s, h) => s + baselineOf(h), 0)

  // Layout — fixed-aspect 358×200 viewBox; the SVG scales to its container.
  const W = 358
  const H = 200
  const padTop = 18
  const padBottom = 22
  const padLeft = 8
  const padRight = 8
  const innerW = W - padLeft - padRight
  const innerH = H - padTop - padBottom
  const colW = innerW / hours.length
  const barW = Math.max(4, colW * 0.62)

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
          {metric === "orders" ? "ORDERS / HOUR" : "SALES / HOUR"} · PEAK{" "}
          {fmtHourLabel(peakHour)}
        </span>
        {showBaseline && totalBaseline > 0 ? (
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
            {metric === "orders"
              ? `${fmtCount(totalValue)} vs ${fmtCount(Math.round(totalBaseline))} avg`
              : `${fmtMoneyShort(totalValue)} vs ${fmtMoneyShort(totalBaseline)} avg`}
          </span>
        ) : null}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Hourly chart"
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          background: "rgba(255, 253, 247, 0.72)",
          border: "1px solid var(--hairline-bold)",
          borderRadius: 2,
        }}
      >
        {/* horizontal hairline at the baseline */}
        <line
          x1={padLeft}
          x2={W - padRight}
          y1={H - padBottom}
          y2={H - padBottom}
          stroke="var(--hairline-bold)"
          strokeWidth={1}
        />
        {/* quarter / half / three-quarter dotted rules for reference */}
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

        {hours.map((h, i) => {
          const v = valueOf(h)
          const b = baselineOf(h)
          const cx = padLeft + colW * i + colW / 2
          const isPeak = h === peakHour && v > 0
          const barH = Math.max(0, (v / max) * innerH)
          const baseH = showBaseline ? Math.max(0, (b / max) * innerH) : 0
          const x = cx - barW / 2
          const baseY = H - padBottom

          return (
            <g key={h}>
              {showBaseline && b > 0 ? (
                <rect
                  x={x}
                  y={baseY - baseH}
                  width={barW}
                  height={baseH}
                  fill="none"
                  stroke="var(--ink-faint)"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  opacity={0.55}
                />
              ) : null}
              {v > 0 ? (
                <rect
                  className="m-chart-bar"
                  style={{ "--i": i } as React.CSSProperties}
                  x={x}
                  y={baseY - barH}
                  width={barW}
                  height={barH}
                  fill={isPeak ? "var(--accent)" : "var(--ink)"}
                  fillOpacity={isPeak ? 1 : 0.86}
                />
              ) : null}
              {/* x-axis hour label, every 2 hours to avoid clutter */}
              {h % 2 === 0 ? (
                <text
                  x={cx}
                  y={H - padBottom + 12}
                  textAnchor="middle"
                  fontFamily="var(--font-jetbrains-mono), ui-monospace, monospace"
                  fontSize={8.5}
                  letterSpacing={1}
                  fill="var(--ink-faint)"
                >
                  {fmtHourLabel(h).toUpperCase()}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
