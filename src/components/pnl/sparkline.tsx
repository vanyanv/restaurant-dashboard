import { cn } from "@/lib/utils"

/**
 * Tiny inline trend line. Pure SVG — no chart library, no runtime cost.
 *
 * Width/height are fixed; caller sizes the container. The line and the end-dot
 * take color from `currentColor`, so it inherits from the surrounding text.
 */
export interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  /** When true, render a faint baseline at y=0 if the series crosses zero. */
  showZero?: boolean
  ariaLabel?: string
  className?: string
}

export function Sparkline({
  values,
  width = 80,
  height = 20,
  showZero = false,
  ariaLabel,
  className,
}: SparklineProps) {
  if (!values.length) return null

  const valid = values.filter((v) => Number.isFinite(v))
  if (valid.length === 0) return null

  const min = Math.min(...valid, showZero ? 0 : Infinity)
  const max = Math.max(...valid, showZero ? 0 : -Infinity)
  const span = max - min || 1
  const pad = 1.5

  const stepX = values.length > 1 ? (width - 2 * pad) / (values.length - 1) : 0
  const toX = (i: number) => pad + i * stepX
  const toY = (v: number) => pad + ((max - v) / span) * (height - 2 * pad)

  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(2)},${toY(v).toFixed(2)}`)
    .join(" ")

  const last = values[values.length - 1]
  const endX = toX(values.length - 1)
  const endY = toY(last)

  const zeroY = showZero && min < 0 && max > 0 ? toY(0) : null

  return (
    <svg
      className={cn("sparkline", className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
    >
      {zeroY != null ? (
        <line x1={pad} x2={width - pad} y1={zeroY} y2={zeroY} stroke="currentColor" strokeOpacity="0.2" strokeWidth="0.5" />
      ) : null}
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={endX} cy={endY} r="1.6" fill="currentColor" />
    </svg>
  )
}
