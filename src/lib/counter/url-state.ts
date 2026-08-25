import {
  COMPARISONS, PRESETS, comparisonRange, resolvePreset,
  type ComparisonId, type DateRange, type PresetId,
} from "./date-range"

/**
 * The range and the store live in the URL.
 *
 * A figure an owner is looking at should survive a reload and be shareable —
 * "look at this week's prime cost" is a link, not a description of which
 * controls to click. It also means the back button works on a range change,
 * which is what a reader expects when a page's numbers changed.
 *
 * Everything here treats the URL as UNTRUSTED. A hand-edited, stale or
 * truncated param must fall back to a sane default rather than throw — a
 * dashboard that 500s on a bad query string is worse than one that shows
 * yesterday.
 */

export interface CounterParams {
  presetId: PresetId
  comparisonId: ComparisonId
  /** null means all stores — the absence of a store, not a magic "all" id. */
  storeId: string | null
  range: DateRange
}

/**
 * Yesterday, not today. An owner opening the dashboard in the morning wants the
 * day that finished, not the one that has barely started — a half-day of
 * figures compared against a whole one reads as a collapse.
 */
const DEFAULT_PRESET: PresetId = "yesterday"
const DEFAULT_COMPARISON: ComparisonId = "prev"

const isPreset = (v: string | null): v is PresetId =>
  v !== null && PRESETS.some((p) => p.id === v)

const isComparison = (v: string | null): v is ComparisonId =>
  v !== null && COMPARISONS.some((c) => c.id === v)

export function readCounterParams(params: URLSearchParams, today: Date): CounterParams {
  const rawPreset = params.get("range")
  const presetId: PresetId = isPreset(rawPreset) ? rawPreset : DEFAULT_PRESET

  const range = resolvePreset(presetId, today)

  const rawCmp = params.get("cmp")
  let comparisonId: ComparisonId = isComparison(rawCmp) ? rawCmp : DEFAULT_COMPARISON

  // The weekday comparison has no meaning past a week — `comparisonRange`
  // returns null there. Offering it anyway would render an empty comparison
  // beside real figures, which reads as "no change" rather than "not asked".
  if (comparisonId === "weekday" && comparisonRange(range, "weekday") === null) {
    comparisonId = DEFAULT_COMPARISON
  }

  const store = params.get("store")

  return { presetId, comparisonId, storeId: store === null || store === "" ? null : store, range }
}

/**
 * Writes only what changed, and DROPS anything at its default so a shared URL
 * stays short and readable. `?range=d30` beats
 * `?range=d30&cmp=prev&store=` for a link someone pastes into a message.
 */
export function writeCounterParams(
  current: URLSearchParams,
  next: Partial<Pick<CounterParams, "presetId" | "comparisonId" | "storeId">>,
): URLSearchParams {
  const out = new URLSearchParams(current)

  if (next.presetId !== undefined) {
    if (next.presetId === DEFAULT_PRESET) out.delete("range")
    else out.set("range", next.presetId)
  }
  if (next.comparisonId !== undefined) {
    if (next.comparisonId === DEFAULT_COMPARISON) out.delete("cmp")
    else out.set("cmp", next.comparisonId)
  }
  if (next.storeId !== undefined) {
    if (next.storeId === null) out.delete("store")
    else out.set("store", next.storeId)
  }

  return out
}
