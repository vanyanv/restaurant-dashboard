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
 * Below this, in percentage points, a change is not a movement — it is
 * rounding. One constant, read by both `delta` and `deltaSign`, so the arrow a
 * reader sees and the tone it is painted in can never disagree about whether
 * the figure moved at all.
 */
const FLAT_WITHIN_PTS = 0.05

/**
 * A delta is a direction plus a magnitude. "flat" rather than "▲ 0.0%",
 * because an arrow that points at nothing is a false signal.
 */
export function delta(v: number | null, opts: { scaled?: boolean } = {}): string {
  if (v === null || !Number.isFinite(v)) return DASH
  const n = opts.scaled ? v : v * 100
  if (Math.abs(n) < FLAT_WITHIN_PTS) return "flat"
  return `${n > 0 ? "▲" : "▼"} ${Math.abs(n).toFixed(1)}%`
}

/**
 * Which way the same change points: `1` up, `-1` down, `0` for the window
 * `delta` prints as "flat", `null` for a change there is no reading of.
 *
 * This exists so a caller can pick a TONE for a delta without re-deriving the
 * threshold or, worse, reading the arrow back out of the string `delta`
 * returned. It is the direction only — whether that direction is good news is
 * a judgement about the figure, and it belongs to whoever knows what the
 * figure is.
 */
export function deltaSign(
  v: number | null,
  opts: { scaled?: boolean } = {},
): -1 | 0 | 1 | null {
  if (v === null || !Number.isFinite(v)) return null
  const n = opts.scaled ? v : v * 100
  if (Math.abs(n) < FLAT_WITHIN_PTS) return 0
  return n > 0 ? 1 : -1
}

/**
 * A change in PERCENTAGE POINTS — "▲ 1.6 pts", or "flat".
 *
 * The prototype's `pts()` (line 3962), and the same `FLAT_WITHIN_PTS` window
 * `delta` uses, so a movement one page calls flat cannot be an arrow on the
 * other. Distinct from `delta` because the two say different things about the
 * same arithmetic: a food line that went from 29.0% to 30.6% moved 1.6 POINTS,
 * and calling that "▲ 5.5%" (its percentage change) is a figure no operator
 * acts on.
 *
 * The input is already in points — 1.6, not 0.016. There is no `scaled`
 * option, because a fraction has no reading here at all.
 */
export function points(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return DASH
  if (Math.abs(v) < FLAT_WITHIN_PTS) return "flat"
  return `${v > 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(1)} pts`
}

export function count(v: number | null): string {
  return v === null || !Number.isFinite(v) ? DASH : v.toLocaleString("en-US")
}
