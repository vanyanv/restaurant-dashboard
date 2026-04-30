/**
 * Shared editorial inline-style tokens for monitoring panels.
 *
 * Use these instead of inlining font + variant settings per element. Colors
 * stay per-call so panels can shift to var(--accent) when something is
 * actually problematic.
 */

export const monoLabel = {
  fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
} as const

export const number = {
  fontFamily: "var(--font-dm-sans), ui-sans-serif, sans-serif",
  fontWeight: 600,
  fontSize: 15.5,
  fontVariantNumeric: "tabular-nums lining-nums",
  letterSpacing: "-0.014em",
} as const

export const fraunces17 = {
  fontFamily: "var(--font-fraunces), serif",
  fontWeight: 500,
  fontSize: 17,
  fontVariationSettings: '"opsz" 96, "SOFT" 40',
} as const

export const dmBody = {
  fontFamily: "var(--font-dm-sans), ui-sans-serif, sans-serif",
  fontSize: 13,
  fontVariantNumeric: "tabular-nums lining-nums",
} as const
