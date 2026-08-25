import {
  COMPARISONS, PRESETS, comparisonRange, isoDay, parseIsoDay, resolvePreset,
  type ComparisonId, type DateRange, type PresetId, type RangeId,
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
  /**
   * A named preset, or "custom" when `from`/`to` carried an arbitrary window.
   * A caller looking this up in PRESETS must handle `undefined` — use
   * `rangeLabel(range, presetId)` instead of a find-with-fallback, which is
   * how the control used to label an unknown id "Today".
   */
  presetId: RangeId
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

/**
 * `from`/`to` beat `range` when both are present, because they are the more
 * specific statement: `range=d7` describes a rule, `from`/`to` describes the
 * exact window a reader pressed. Anything unparseable, half-present or
 * backwards is discarded entirely rather than half-applied — a range whose
 * end precedes its start would produce a negative day count and a division by
 * it downstream.
 */
function readCustomRange(params: URLSearchParams): DateRange | null {
  const rawFrom = params.get("from")
  const rawTo = params.get("to")
  if (rawFrom === null || rawTo === null) return null

  const start = parseIsoDay(rawFrom)
  const end = parseIsoDay(rawTo)
  if (start === null || end === null) return null
  if (start.getTime() > end.getTime()) return null

  return { start, end }
}

export function readCounterParams(params: URLSearchParams, today: Date): CounterParams {
  const custom = readCustomRange(params)

  const rawPreset = params.get("range")
  const presetId: RangeId = custom !== null
    ? "custom"
    : isPreset(rawPreset)
      ? rawPreset
      : DEFAULT_PRESET

  const range = custom ?? resolvePreset(presetId as PresetId, today)

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
  next: Partial<Pick<CounterParams, "comparisonId" | "storeId">> & {
    presetId?: PresetId
    /**
     * An arbitrary window — a pressed week (note 53) or a stepped period.
     * Setting it clears `range`; passing null clears `from`/`to` and leaves
     * whatever named range was there. The two are mutually exclusive in the
     * URL because they are mutually exclusive in meaning, and
     * `readCustomRange` resolves any conflict in `from`/`to`'s favour.
     */
    range?: DateRange | null
  },
): URLSearchParams {
  const out = new URLSearchParams(current)

  if (next.presetId !== undefined) {
    out.delete("from")
    out.delete("to")
    if (next.presetId === DEFAULT_PRESET) out.delete("range")
    else out.set("range", next.presetId)
  }
  if (next.range !== undefined) {
    if (next.range === null) {
      out.delete("from")
      out.delete("to")
    } else {
      out.delete("range")
      out.set("from", isoDay(next.range.start))
      out.set("to", isoDay(next.range.end))
    }
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
