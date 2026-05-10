import type { HarriDailyRow } from "@/app/actions/harri-actions"

type Props = {
  rows: HarriDailyRow[]
  /** Eyebrow label, e.g. "ACTUAL VS FORECAST · LAST 7D". */
  label?: string
}

const fmtMoneyShort = (n: number) => {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${Math.round(n)}`
}

const fmtDateTick = (iso: string) => {
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
 * 7-day actual-vs-forecast labor cost strip. Filled bar = actual cost (ink),
 * dashed outline = forecast cost (ink-faint). Days where actual > forecast by
 * more than 5% turn the bar accent-red. Mirrors `DailyRevenueChart`'s SVG
 * grammar.
 */
export function LaborWeekStrip({
  rows,
  label = "ACTUAL VS FORECAST · LAST 7D",
}: Props) {
  if (rows.length === 0) {
    return (
      <div className="m-chart-frame dock-in dock-in-3">
        <div className="m-empty m-empty--flush">
          No Harri data for this window.
        </div>
      </div>
    )
  }

  const totalActual = rows.reduce((s, r) => s + (r.actualCost ?? 0), 0)
  const totalForecast = rows.reduce((s, r) => s + (r.forecastCost ?? 0), 0)
  const variancePct =
    totalForecast === 0 ? 0 : (totalActual - totalForecast) / totalForecast

  const max = Math.max(
    1,
    ...rows.flatMap((r) => [r.actualCost ?? 0, r.forecastCost ?? 0]),
  )

  const W = 358
  const H = 200
  const padTop = 18
  const padBottom = 22
  const padLeft = 8
  const padRight = 8
  const innerW = W - padLeft - padRight
  const innerH = H - padTop - padBottom
  const colW = innerW / rows.length
  const barW = Math.max(4, colW * 0.62)
  const tickEvery = rows.length > 10 ? 2 : 1

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
          {label}
        </span>
        <span
          style={{
            fontFamily:
              "var(--font-jetbrains-mono), ui-monospace, monospace",
            fontSize: 9.5,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: variancePct > 0.05 ? "var(--accent)" : "var(--ink-faint)",
            fontVariantNumeric: "tabular-nums lining-nums",
          }}
        >
          {fmtMoneyShort(totalActual)} actual · {variancePct >= 0 ? "+" : ""}
          {(variancePct * 100).toFixed(1)}%
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Actual vs forecast labor cost chart"
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

        {rows.map((row, i) => {
          const cx = padLeft + colW * i + colW / 2
          const x = cx - barW / 2
          const baseY = H - padBottom
          const actual = row.actualCost ?? 0
          const forecast = row.forecastCost ?? 0
          const actualH = (actual / max) * innerH
          const forecastH = (forecast / max) * innerH
          const overbudget =
            row.variancePct != null && row.variancePct > 0.05
          return (
            <g key={row.date}>
              {forecast > 0 ? (
                <rect
                  x={x}
                  y={baseY - forecastH}
                  width={barW}
                  height={forecastH}
                  fill="none"
                  stroke="var(--ink-faint)"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  opacity={0.6}
                >
                  <title>
                    {`${fmtDateFull(row.date)} — forecast ${fmtMoneyShort(forecast)}`}
                  </title>
                </rect>
              ) : null}
              {actual > 0 ? (
                <rect
                  className="m-chart-bar"
                  style={{ "--i": i } as React.CSSProperties}
                  x={x}
                  y={baseY - actualH}
                  width={barW}
                  height={actualH}
                  fill={overbudget ? "var(--accent)" : "var(--ink)"}
                  fillOpacity={overbudget ? 1 : 0.86}
                >
                  <title>
                    {`${fmtDateFull(row.date)} — actual ${fmtMoneyShort(actual)}${
                      row.variancePct != null
                        ? ` (${row.variancePct >= 0 ? "+" : ""}${(row.variancePct * 100).toFixed(1)}%)`
                        : ""
                    }`}
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
