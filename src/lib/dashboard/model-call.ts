/**
 * "The model's call" — the overview band that says what today should have been
 * and why the model thought so.
 *
 * `ForecastDailyRevenue.attribution` is a TreeSHAP waterfall written by
 * ml/models/attribution.py and already grouped for operators: nobody running a
 * restaurant wants `lag_7` weighed against `roll_28`. The column is `Json` and
 * comes from a separate Python pipeline, so everything here parses defensively
 * — a malformed payload renders no waterfall rather than throwing on the
 * dashboard's critical path.
 *
 * Session-free and I/O-free so the geometry is testable without a database.
 */

export interface AttributionGroup {
  label: string
  value: number
}

export interface Attribution {
  base: number
  groups: AttributionGroup[]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

export function parseAttribution(raw: unknown): Attribution | null {
  if (!isRecord(raw)) return null
  const base = raw.base
  if (typeof base !== "number" || !Number.isFinite(base)) return null

  const rawGroups = raw.groups
  if (!Array.isArray(rawGroups)) return null

  const groups: AttributionGroup[] = []
  for (const g of rawGroups) {
    if (!isRecord(g)) continue
    const { label, value } = g
    if (typeof label !== "string" || !label.trim()) continue
    if (typeof value !== "number" || !Number.isFinite(value)) continue
    groups.push({ label: label.trim(), value })
  }

  if (groups.length === 0) return null
  return { base, groups }
}

/**
 * Sum attributions across stores, matching groups by label. Bases add; a label
 * present in one store and absent in another contributes only where it exists,
 * which is the correct reading of a per-store SHAP contribution.
 */
export function mergeAttributions(list: Attribution[]): Attribution | null {
  const usable = list.filter((a): a is Attribution => a != null)
  if (usable.length === 0) return null
  if (usable.length === 1) return usable[0]

  const base = usable.reduce((sum, a) => sum + a.base, 0)
  const byLabel = new Map<string, number>()
  const order: string[] = []
  for (const a of usable) {
    for (const g of a.groups) {
      if (!byLabel.has(g.label)) order.push(g.label)
      byLabel.set(g.label, (byLabel.get(g.label) ?? 0) + g.value)
    }
  }

  return { base, groups: order.map((label) => ({ label, value: byLabel.get(label)! })) }
}

export interface WaterfallBar {
  label: string
  value: number
  /** Fraction of the chart width this bar's magnitude occupies, 0–1. */
  widthPct: number
  /** Running total after this bar, as a fraction of the largest running total. */
  runningPct: number
  direction: "up" | "down"
}

export interface Waterfall {
  base: number
  basePct: number
  total: number
  bars: WaterfallBar[]
}

/**
 * Waterfall geometry. Widths are scaled against the largest running total so
 * the base bar and the final total are directly comparable, which is the whole
 * point of drawing it rather than listing the numbers.
 *
 * Groups smaller than `minSharePct` of the base are dropped into a single
 * "Other" bar — a SHAP payload can carry a dozen groups and a dozen slivers
 * read as noise.
 */
export function buildWaterfall(
  a: Attribution,
  opts: { maxBars?: number; minSharePct?: number } = {}
): Waterfall | null {
  const maxBars = opts.maxBars ?? 5
  const minShare = (opts.minSharePct ?? 0.5) / 100

  if (!Number.isFinite(a.base) || a.base <= 0) return null

  const threshold = Math.abs(a.base) * minShare
  const kept = a.groups.filter((g) => Math.abs(g.value) >= threshold)
  const dropped = a.groups.filter((g) => Math.abs(g.value) < threshold)

  // Biggest movers first by magnitude, then anything past maxBars folded in
  // with the sub-threshold slivers so the total still reconciles.
  const sorted = [...kept].sort((x, y) => Math.abs(y.value) - Math.abs(x.value))
  const head = sorted.slice(0, maxBars)
  const tail = sorted.slice(maxBars)
  const otherValue =
    [...tail, ...dropped].reduce((sum, g) => sum + g.value, 0)

  const shown: AttributionGroup[] =
    Math.abs(otherValue) > 0 ? [...head, { label: "Other", value: otherValue }] : head

  const total = a.base + shown.reduce((sum, g) => sum + g.value, 0)
  const scale = Math.max(a.base, total, ...shown.map(() => 0)) || 1

  let running = a.base
  const bars: WaterfallBar[] = shown.map((g) => {
    running += g.value
    return {
      label: g.label,
      value: g.value,
      widthPct: Math.min(1, Math.abs(g.value) / scale),
      runningPct: Math.min(1, Math.max(0, running / scale)),
      direction: g.value >= 0 ? "up" : "down",
    }
  })

  return { base: a.base, basePct: Math.min(1, a.base / scale), total, bars }
}

export interface IntervalReading {
  /** Where the actual sits on the p10→p90 track, 0–1, clamped. */
  markPct: number
  /** Where the point forecast sits on the same track, 0–1. */
  forecastPct: number
  inside: boolean
}

/**
 * Position of the day's actual against the model's predictive interval. Returns
 * null rather than a degenerate track when p10 and p90 collapse — a zero-width
 * interval is a pipeline problem, not something to draw.
 */
export function readInterval(input: {
  p10: number | null
  p90: number | null
  forecast: number
  actual: number
}): IntervalReading | null {
  const { p10, p90, forecast, actual } = input
  if (p10 == null || p90 == null) return null
  if (!Number.isFinite(p10) || !Number.isFinite(p90)) return null
  if (!(p90 > p10)) return null

  const pct = (v: number) => Math.min(1, Math.max(0, (v - p10) / (p90 - p10)))
  return {
    markPct: pct(actual),
    forecastPct: pct(forecast),
    inside: actual >= p10 && actual <= p90,
  }
}
