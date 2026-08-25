import type { Waterfall } from "@/lib/dashboard/model-call"

const W = 700
const H = 132
const AXIS_Y = 96
const PLOT_H = 78
const LABEL_Y = 112

/**
 * Attribution waterfall: a base column, one floating column per operator-grouped
 * SHAP contribution, and the resulting forecast. Negative contributions use the
 * red crosshatch — DESIGN.md's only sanctioned red fill family, and the same
 * texture the P&L waterfall uses for a subtraction.
 */
export function ModelCallChart({
  waterfall,
  format,
}: {
  waterfall: Waterfall
  format: (n: number) => string
}) {
  const columns = waterfall.bars.length + 2
  const gap = 12
  const colW = Math.max(28, (W - gap * (columns - 1)) / columns)

  // Every level the waterfall touches, so the axis can be cropped to them.
  const levels: number[] = [waterfall.base, waterfall.total]
  let walk = waterfall.base
  for (const b of waterfall.bars) {
    walk += b.value
    levels.push(walk)
  }
  // Anchoring at zero makes a $6.8k base with ±$500 movers read as two black
  // slabs and four slivers. Crop to the levels actually visited, with a little
  // headroom, so the contributions are the thing you can see.
  const lo = Math.min(...levels)
  const hi = Math.max(...levels)
  const pad = Math.max((hi - lo) * 0.35, hi * 0.02) || 1
  const floor = Math.max(0, lo - pad)
  const span = hi + pad * 0.25 - floor || 1
  const yOf = (v: number) => AXIS_Y - ((v - floor) / span) * PLOT_H

  const x = (i: number) => i * (colW + gap)

  let running = waterfall.base
  const floats = waterfall.bars.map((bar, i) => {
    const from = running
    running += bar.value
    const to = running
    const top = Math.min(yOf(from), yOf(to))
    const height = Math.max(2, Math.abs(yOf(from) - yOf(to)))
    return { bar, i: i + 1, top, height, connectorY: yOf(to) }
  })

  return (
    <svg
      className="model-call__chart"
      viewBox={`0 0 ${W} ${H}`}
      height={H}
      role="img"
      aria-label={`Forecast attribution: baseline ${format(
        waterfall.base
      )}, ${waterfall.bars
        .map((b) => `${b.label} ${b.value >= 0 ? "plus" : "minus"} ${format(Math.abs(b.value))}`)
        .join(", ")}, forecast ${format(waterfall.total)}.`}
    >
      <defs>
        <pattern
          id="model-call-hatch"
          width="6"
          height="6"
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
        >
          <rect width="6" height="6" fill="var(--accent-bg)" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--accent)" strokeWidth="1.5" />
        </pattern>
      </defs>

      {/* Not a zero line — the axis is cropped to the levels the waterfall
          visits (see `floor` above), so it is drawn dotted to avoid reading as
          a baseline of nought. */}
      <line
        x1="0"
        y1={AXIS_Y}
        x2={W}
        y2={AXIS_Y}
        stroke="var(--hairline-bold)"
        strokeWidth="1"
        strokeDasharray="2 3"
      />

      {/* base */}
      <rect
        x={x(0)}
        y={yOf(waterfall.base)}
        width={colW}
        height={AXIS_Y - yOf(waterfall.base)}
        fill="var(--ink)"
      />
      <text
        x={x(0) + colW / 2}
        y={yOf(waterfall.base) - 7}
        textAnchor="middle"
        fontSize="10"
        fill="var(--ink)"
        className="font-mono tabular-nums"
      >
        {format(waterfall.base)}
      </text>
      <text
        x={x(0) + colW / 2}
        y={LABEL_Y}
        textAnchor="middle"
        fontSize="9"
        fill="var(--ink-faint)"
        className="font-mono"
        letterSpacing="0.8"
      >
        BASE
      </text>

      {floats.map(({ bar, i, top, height, connectorY }) => (
        <g key={`${bar.label}-${i}`}>
          <line
            x1={x(i - 1) + colW}
            y1={i === 1 ? yOf(waterfall.base) : top}
            x2={x(i)}
            y2={i === 1 ? yOf(waterfall.base) : top}
            stroke="var(--ink-ornament)"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
          <rect
            x={x(i)}
            y={top}
            width={colW}
            height={height}
            fill={
              bar.direction === "down"
                ? "url(#model-call-hatch)"
                : "var(--ink)"
            }
            opacity={bar.direction === "down" ? 1 : 0.72}
            stroke={bar.direction === "down" ? "var(--accent)" : "none"}
            strokeWidth="0.75"
          />
          <text
            x={x(i) + colW / 2}
            y={top - 7}
            textAnchor="middle"
            fontSize="10"
            fill={bar.direction === "down" ? "var(--subtract)" : "var(--ink)"}
            className="font-mono tabular-nums"
          >
            {bar.direction === "down" ? "−" : "+"}
            {format(Math.abs(bar.value))}
          </text>
          <text
            x={x(i) + colW / 2}
            y={LABEL_Y}
            textAnchor="middle"
            fontSize="9"
            fill="var(--ink-faint)"
            className="font-mono"
            letterSpacing="0.2"
          >
            {bar.label.toUpperCase()}
          </text>
          <line
            x1={x(i) + colW}
            y1={connectorY}
            x2={x(i + 1)}
            y2={connectorY}
            stroke="var(--ink-ornament)"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
        </g>
      ))}

      {/* total */}
      <rect
        x={x(columns - 1)}
        y={yOf(waterfall.total)}
        width={colW}
        height={AXIS_Y - yOf(waterfall.total)}
        fill="var(--ink)"
      />
      <text
        x={x(columns - 1) + colW / 2}
        y={yOf(waterfall.total) - 7}
        textAnchor="middle"
        fontSize="10"
        fill="var(--ink)"
        className="font-mono tabular-nums"
      >
        {format(waterfall.total)}
      </text>
      <text
        x={x(columns - 1) + colW / 2}
        y={LABEL_Y}
        textAnchor="middle"
        fontSize="9"
        fill="var(--ink-faint)"
        className="font-mono"
        letterSpacing="0.8"
      >
        FORECAST
      </text>
    </svg>
  )
}
