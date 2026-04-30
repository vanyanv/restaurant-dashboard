"use client"

type Point = { x: number | Date; y: number }

export function InlineSpark({
  points,
  width = 80,
  height = 16,
  baselineMultiplier = 1.5,
}: {
  points: Point[]
  width?: number
  height?: number
  baselineMultiplier?: number
}) {
  if (points.length === 0) {
    return <span className="inline-block" style={{ width, height }} aria-hidden />
  }
  const ys = points.map((p) => p.y)
  const max = Math.max(1, ...ys)
  const min = Math.min(0, ...ys)
  const range = max - min || 1
  const stepX = points.length > 1 ? width / (points.length - 1) : 0
  const path = points
    .map((p, i) => {
      const x = i * stepX
      const y = height - ((p.y - min) / range) * height
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
  const last = points[points.length - 1]
  const lastX = (points.length - 1) * stepX
  const lastY = height - ((last.y - min) / range) * height
  const baseline =
    ys.length > 1
      ? ys.slice(0, -1).reduce((a, b) => a + b, 0) / (ys.length - 1)
      : 0
  const isElevated = baseline > 0 && last.y > baseline * baselineMultiplier
  return (
    <svg
      width={width}
      height={height}
      aria-hidden
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      <path d={path} fill="none" stroke="var(--ink-muted)" strokeWidth={1} />
      <circle
        cx={lastX}
        cy={lastY}
        r={1.6}
        fill={isElevated ? "var(--accent)" : "var(--ink)"}
      />
    </svg>
  )
}
