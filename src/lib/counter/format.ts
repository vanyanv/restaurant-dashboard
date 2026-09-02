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

/**
 * A price PER UNIT, which is the one money figure two decimals is not enough
 * for.
 *
 * Ingredient costs run from $4.86 a pound to $0.0013 a case of bath tissue.
 * At two decimals the second prints "$0.00", which reads as free beside a
 * column of real prices — and it is not free, it is a cost small enough that
 * two decimals cannot hold it. So anything that would round away to zero gets
 * the digits it needs, up to four, and everything else stays at the two the
 * rest of the product uses.
 */
export function unitCost(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return DASH
  const abs = Math.abs(v)
  const digits = abs > 0 && abs < 0.01 ? 4 : 2
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return v < 0 ? `($${body})` : `$${body}`
}

/**
 * Title Case for a name stored lower-cased.
 *
 * `CanonicalIngredient.name` and the names on the invoice's costed-ingredient
 * rows are both stored lower-cased, and both are printed in tables beside
 * proper nouns.
 *
 * A word boundary is not enough: `\b` sits between the apostrophe and the `s`
 * of "eddy's", so `\b[a-z]` writes "Eddy'S". The boundary that matters is a
 * letter preceded by something that is neither a letter nor an apostrophe.
 *
 * The supplier's own abbreviations are left exactly as they are — "grnd"
 * becomes "Grnd", not "Ground". Expanding them would be inventing a name the
 * invoice never said.
 */
export function titleCase(s: string): string {
  return s.replace(/(^|[^A-Za-z'])([a-z])/g, (_, pre: string, c: string) => pre + c.toUpperCase())
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

/**
 * A count and the thing it counts, agreeing about number.
 *
 * ## Why this exists
 *
 * Counter pages build their captions as `${count(n)} days`, and the "s" is
 * typed into the template. That is correct for the constants (a 90-day window
 * is always 90 days) and wrong the moment the number comes from the data. The
 * Overview at its OWN DEFAULT RANGE — one day, which is what the rail's
 * "Today" group opens to — printed three of them on one screen:
 *
 *     RANGE   1 days
 *             1 daily buckets · vs the prior period
 *     SALES PER LABOR HOUR
 *             1 daily readings with labor posted
 *
 * On a product whose entire claim is that its numbers are careful, "1 days"
 * on the first screen is not a typo the reader forgives; it is the first
 * evidence they have about how much attention the figures got.
 *
 * ## The plural is passed in, never derived
 *
 * No "add an s" rule. English does not have one that survives contact with
 * this product's nouns, and a helper that silently produced "1 boxs" or
 * "2 companys" would be a worse bug than the one it replaced — harder to see,
 * because it would look deliberate. The caller writes both forms when they
 * differ and one form when they do not.
 *
 * `plural(1, "day")` → `1 day` · `plural(7, "day")` → `7 days`
 * `plural(1, "box", "boxes")` → `1 box`
 *
 * A null count keeps `count`'s em dash and takes the plural, which is the
 * form that reads as a placeholder rather than as an assertion about one
 * thing: "— days".
 */
export function plural(v: number | null, one: string, many = `${one}s`): string {
  return `${count(v)} ${v === 1 ? one : many}`
}

/**
 * A size in bytes, at the scale this product operates at.
 *
 * One function because the figure appears on two pages: the monitoring bridge
 * and the infrastructure tab both read `DbSnapshot.totalBytes`, and before
 * this they divided by different constants — 1048576 on one, 1,000,000 on the
 * other — so the same database read 292 MB on one page and 306 MB on the
 * page it links to. Decimal, because that is what the bill is denominated in.
 */
export function bytes(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return DASH
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)} GB`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)} MB`
  return `${(v / 1e3).toFixed(0)} KB`
}
