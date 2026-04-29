/**
 * Shared Recharts theme tokens for chat-trend artifacts. Editorial register:
 * ink stroke for series, hairline grid, accent only on hover-focus, DM Sans
 * tabular-num tooltip body. Reused across every TrendCard chart variant so
 * the cream-paper page never lights up with default Recharts blues.
 */

export const editorialChart = {
  /** Plotted line / bar fill colour. */
  inkStroke: "var(--ink)",
  inkFill: "var(--ink)",
  /** Reference grid + axis lines. */
  hairline: "var(--hairline-bold, rgba(26,22,19,0.18))",
  axisTick: "var(--ink-faint, rgba(26,22,19,0.45))",
  /** Hover / focus colour (the proofmark red, used sparingly). */
  accent: "var(--accent, #dc2626)",
  /** Tooltip ground. */
  paper: "var(--paper, #fdf8ef)",
} as const

export const tooltipContentStyle: React.CSSProperties = {
  background: "var(--paper)",
  border: "1px solid var(--hairline-bold)",
  borderRadius: 0,
  padding: "8px 10px",
  fontFamily: "var(--font-dm-sans), ui-sans-serif, system-ui, sans-serif",
  fontSize: 12,
  color: "var(--ink)",
  fontVariantNumeric: "tabular-nums lining-nums",
  boxShadow: "none",
}

export const tooltipLabelStyle: React.CSSProperties = {
  fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "var(--ink-faint)",
  marginBottom: 4,
}

export const axisTickStyle = {
  fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
  fontSize: 10,
  fill: "var(--ink-faint)",
  letterSpacing: "0.08em",
} as const
