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
  if (v === null) return DASH
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
  if (v === null) return DASH
  const abs = Math.abs(v)
  const sign = v < 0 ? "-" : ""
  if (abs >= 1_000_000) return `${sign}$${trimZero(abs / 1_000_000)}M`
  if (abs >= 1_000) return `${sign}$${trimZero(abs / 1_000)}K`
  return `${sign}$${Math.round(abs)}`
}

function trimZero(n: number): string {
  const s = n.toFixed(1)
  return s.endsWith(".0") ? s.slice(0, -2) : s
}

export function pct(v: number | null, opts: { scaled?: boolean } = {}): string {
  if (v === null) return DASH
  const n = opts.scaled ? v : v * 100
  return `${n.toFixed(1)}%`
}

/**
 * A delta is a direction plus a magnitude. "flat" rather than "▲ 0.0%",
 * because an arrow that points at nothing is a false signal.
 */
export function delta(v: number | null, opts: { scaled?: boolean } = {}): string {
  if (v === null) return DASH
  const n = opts.scaled ? v : v * 100
  if (Math.abs(n) < 0.05) return "flat"
  return `${n > 0 ? "▲" : "▼"} ${Math.abs(n).toFixed(1)}%`
}

export function count(v: number | null): string {
  return v === null ? DASH : v.toLocaleString("en-US")
}
