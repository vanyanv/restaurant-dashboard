import {
  COMPARISONS, PRESETS, comparisonRange, isoDay, parseIsoDay, resolvePreset,
  type ComparisonId, type DateRange, type PresetId, type RangeId,
} from "./date-range"
import { CHANNELS, type ChannelId } from "./channels"

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
  /**
   * The pressed channel toggles on the orders list. EMPTY IS EVERY CHANNEL.
   *
   * That asymmetry is the whole of the filter's meaning and it is not a
   * shortcut: with no toggle pressed there is no platform filter at all, so an
   * order on a slug that has no Counter channel (`chownow`, and whatever Otter
   * adds next) is included. With all four pressed the filter becomes
   * `platform IN (the four channels' slugs)` and those orders VANISH. So "all
   * four pressed" and "none pressed" are different questions, and Clear must
   * ask the second one — see `writeCounterParams`.
   */
  channels: ChannelId[]
  /** The free-text filter on the orders list. `""` is no search. */
  search: string
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

const isChannel = (v: string): v is ChannelId => CHANNELS.some((c) => c.id === v)

/**
 * `channels=doordash,house` — the pressed toggles, in the order they were
 * written, deduplicated, with anything unrecognised DROPPED.
 *
 * Dropping rather than throwing is the file's own rule applied to a new key:
 * `channelById` throws on an unknown id, and this string is user input. A
 * stale link from before a channel was renamed must open the orders list, not
 * a 500.
 */
function readChannels(params: URLSearchParams): ChannelId[] {
  const raw = params.get("channels")
  if (raw === null || raw === "") return []
  const out: ChannelId[] = []
  for (const part of raw.split(",")) {
    const id = part.trim()
    if (isChannel(id) && !out.includes(id)) out.push(id)
  }
  return out
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

  return {
    presetId,
    comparisonId,
    storeId: store === null || store === "" ? null : store,
    range,
    channels: readChannels(params),
    search: params.get("q") ?? "",
  }
}

/**
 * Writes only what changed, and DROPS anything at its default so a shared URL
 * stays short and readable. `?range=d30` beats
 * `?range=d30&cmp=prev&store=` for a link someone pastes into a message.
 */
export function writeCounterParams(
  current: URLSearchParams,
  next: Partial<Pick<CounterParams, "comparisonId" | "storeId" | "channels" | "search">> & {
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
  /*
   * Both orders keys are REMOVED at their default rather than written empty,
   * and for `channels` that is not only about a tidy URL.
   *
   * `?channels=` and no `channels` key at all must mean the same thing, since
   * `readChannels` reads both as "no toggle pressed" — but the reverse
   * mistake is the dangerous one. "Clear filters" has to arrive here as
   * `channels: []`, never as all four ids: an absent key is NO platform
   * filter, so an order on a slug outside the four channels comes back, while
   * all four ids is `platform IN (...)` and quietly drops those same orders.
   * A Clear that narrows the list is the worst possible reading of the word.
   */
  if (next.channels !== undefined) {
    if (next.channels.length === 0) out.delete("channels")
    else out.set("channels", next.channels.join(","))
  }
  if (next.search !== undefined) {
    // Trimmed, because a box holding one space is a box the reader has
    // emptied — and `?q=%20` would filter every order out of the list.
    const q = next.search.trim()
    if (q === "") out.delete("q")
    else out.set("q", q)
  }

  return out
}
