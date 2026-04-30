"use client"

/**
 * Editorial tooltip for monitoring Recharts charts.
 *
 * Uses paper background, hairline-bold border, JetBrains Mono caption, DM Sans
 * tabular-nums for the value. Designed to match the editorial docket system.
 */

type TooltipPayloadEntry = {
  value?: number | string | Array<number | string>
  name?: string | number
  dataKey?: string | number
  color?: string
  payload?: Record<string, unknown>
}

export type EditorialTooltipProps = {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: string | number
  unit?: string
  prefix?: string
  /** how to format the numeric value; default toFixed(1) */
  format?: (v: number) => string
  /** if provided, lookup color per series name */
  seriesColors?: Record<string, string>
}

export function EditorialTooltip({
  active,
  payload,
  label,
  unit = "",
  prefix = "",
  format,
  seriesColors,
}: EditorialTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  const fmt = (v: unknown): string => {
    let n: number | null = null
    if (typeof v === "number") n = v
    else if (Array.isArray(v) && typeof v[0] === "number") n = v[0]
    if (n === null) return String(v ?? "")
    if (format) return format(n)
    return n.toFixed(1)
  }

  return (
    <div
      style={{
        background: "rgba(255, 253, 247, 0.96)",
        border: "1px solid var(--hairline-bold)",
        borderRadius: 2,
        padding: "6px 10px",
        fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--ink)",
        boxShadow: "0 1px 2px rgba(26, 22, 19, 0.06)",
      }}
    >
      {label !== undefined && label !== "" && (
        <div style={{ color: "var(--ink-faint)", marginBottom: 4 }}>
          {String(label)}
        </div>
      )}
      {payload.map((p, i) => {
        const seriesKey = String(p.dataKey ?? p.name ?? i)
        const swatch =
          seriesColors?.[seriesKey] ?? p.color ?? "var(--ink)"
        return (
          <div
            key={`${seriesKey}-${i}`}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginTop: i > 0 ? 2 : 0,
            }}
          >
            {payload.length > 1 && (
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  background: swatch,
                  border: "1px solid var(--hairline-bold)",
                  flexShrink: 0,
                }}
              />
            )}
            {payload.length > 1 && (
              <span style={{ color: "var(--ink-faint)" }}>{seriesKey}</span>
            )}
            <span
              style={{
                fontFamily: "var(--font-dm-sans), ui-sans-serif, sans-serif",
                fontVariantNumeric: "tabular-nums lining-nums",
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: 0,
                textTransform: "none",
                color: "var(--ink)",
                marginLeft: payload.length > 1 ? "auto" : 0,
              }}
            >
              {prefix}
              {fmt(p.value)}
              {unit}
            </span>
          </div>
        )
      })}
    </div>
  )
}
