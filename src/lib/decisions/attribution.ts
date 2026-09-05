/**
 * The forecast's own explanation of itself.
 *
 * `ml/models/attribution.py` writes a TreeSHAP waterfall onto each forecast row:
 * a base — the model's average output, what a day with no distinguishing
 * features would earn — plus the groups that moved it, summing to the
 * prediction. This side parses that payload out of untyped JSON and merges it
 * across stores for the portfolio view.
 *
 * Merging is legitimate because SHAP contributions are additive: two stores'
 * "Day of week" effects sum exactly the way their forecasts do.
 */

export interface AttributionGroup {
  label: string
  value: number
}

export interface Attribution {
  base: number
  groups: AttributionGroup[]
}

/** Merged groups this small are rounding, not reasons. */
const EPSILON = 0.5

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

/**
 * Parse a payload straight out of Prisma's `Json` column.
 *
 * A malformed group is dropped rather than rendered — a bar labelled `NaN` is
 * worse than a missing bar. A malformed base rejects the whole waterfall,
 * because a chart that cannot add up misleads more than it explains.
 */
export function parseAttribution(raw: unknown): Attribution | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (!isFiniteNumber(obj.base)) return null
  if (!Array.isArray(obj.groups)) return null

  const groups: AttributionGroup[] = []
  for (const g of obj.groups) {
    if (g == null || typeof g !== "object") continue
    const entry = g as Record<string, unknown>
    if (typeof entry.label !== "string" || !isFiniteNumber(entry.value)) continue
    groups.push({ label: entry.label, value: entry.value })
  }
  return { base: obj.base, groups }
}

/**
 * Sum several stores' waterfalls into one. Groups are re-sorted by magnitude
 * afterwards, because the order that mattered per store need not survive the
 * merge — and a group that cancels to nothing is dropped rather than shown as
 * a zero-height bar.
 */
export function mergeAttributions(
  parts: Array<Attribution | null | undefined>,
): Attribution | null {
  const usable = parts.filter((p): p is Attribution => p != null)
  if (usable.length === 0) return null

  let base = 0
  const byLabel = new Map<string, number>()
  for (const part of usable) {
    base += part.base
    for (const g of part.groups) {
      byLabel.set(g.label, (byLabel.get(g.label) ?? 0) + g.value)
    }
  }

  const groups = [...byLabel.entries()]
    .map(([label, value]) => ({ label, value }))
    .filter((g) => Math.abs(g.value) >= EPSILON)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

  return { base, groups }
}
