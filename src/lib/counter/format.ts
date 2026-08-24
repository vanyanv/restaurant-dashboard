/**
 * Every figure in Counter is formatted here, so the same number cannot be
 * written two ways on two pages.
 *
 * The em-dash rule matters more than it looks: a section with no value must
 * not render "$0" or "0%", because zero is a measurement and absence is not.
 * The prototype uses an em-dash for exactly this and so do we.
 */

/** Applied to every figure. DM Sans carries tabular lining numerals; without this, columns of numbers do not line up. */
export const TABULAR = "tabular-nums lining-nums"

const DASH = "—"

export function money(v: number | null, opts: { cents?: boolean } = {}): string {
  if (v === null || !Number.isFinite(v)) return DASH
  const digits = opts.cents ? 2 : 0
  const abs = Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  // Parentheses, not a minus sign: this is a ledger, and a bracketed figure
  // reads as a subtraction at a glance where "-$2,208" reads as a range.
  return v < 0 ? `($${abs})` : `$${abs}`
}

export function moneyCompact(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return DASH
  const sign = v < 0 ? "-" : ""
  return `${sign}${compactUnsigned(Math.abs(v))}`
}

/**
 * Rounding happens INSIDE each tier, which can push the rounded value up
 * into the next tier's magnitude — and the old code tested magnitude
 * BEFORE rounding, so it missed that: `moneyCompact(999_999)` rounded to
 * "1000.0" inside the K tier and printed "$1000K" instead of promoting to
 * "$1M"; `moneyCompact(999.6)` rounded to 1000 whole dollars and printed
 * "$1000" instead of promoting to "$1K". Recursing into the next tier
 * whenever a tier's own rounding reaches its own ceiling fixes both
 * boundaries the same way.
 */
function compactUnsigned(abs: number): string {
  if (abs >= 1_000_000) return `$${trimZero(abs / 1_000_000)}M`
  if (abs >= 1_000) {
    const s = trimZero(abs / 1_000)
    return s === "1000" ? `$${trimZero(abs / 1_000_000)}M` : `$${s}K`
  }
  const rounded = Math.round(abs)
  return rounded >= 1000 ? compactUnsigned(rounded) : `$${rounded}`
}

function trimZero(n: number): string {
  const s = n.toFixed(1)
  return s.endsWith(".0") ? s.slice(0, -2) : s
}

export function pct(v: number | null, opts: { scaled?: boolean } = {}): string {
  if (v === null || !Number.isFinite(v)) return DASH
  const n = opts.scaled ? v : v * 100
  return `${n.toFixed(1)}%`
}

/**
 * A delta is a direction plus a magnitude. "flat" rather than "▲ 0.0%",
 * because an arrow that points at nothing is a false signal.
 */
export function delta(v: number | null, opts: { scaled?: boolean } = {}): string {
  if (v === null || !Number.isFinite(v)) return DASH
  const n = opts.scaled ? v : v * 100
  if (Math.abs(n) < 0.05) return "flat"
  return `${n > 0 ? "▲" : "▼"} ${Math.abs(n).toFixed(1)}%`
}

export function count(v: number | null): string {
  return v === null || !Number.isFinite(v) ? DASH : v.toLocaleString("en-US")
}
