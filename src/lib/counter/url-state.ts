import {
  COMPARISONS, PRESETS, comparisonRange, isoDay, parseIsoDay, resolvePreset,
  type ComparisonId, type DateRange, type PresetId, type RangeId,
} from "./date-range"
import { CHANNELS, type ChannelId } from "./channels"
import {
  DEFAULT_ALERT_SEGMENT,
  isAlertSegment,
  isAlertSeverity,
  isAlertSource,
  type AlertSegment,
} from "./alert-filters"
import type { AlertSeverity, AlertSource } from "@/generated/prisma/client"

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
  /**
   * The day the week picker has selected, as an ISO day key — or null for
   * "whichever day it is today", which is what the adapter falls back to.
   *
   * In the URL for the same reason the range is: pressing a day on
   * `/dashboard/decisions` has to survive a reload and travel in a link, and
   * the DESK and the PHONE read the same key off the same query string, so a
   * shared link opens on the same day on both surfaces.
   *
   * UNTRUSTED. See `readDay`.
   */
  day: string | null
  /**
   * The alert inbox's segmented control — `P.alerts.seg`, `['Open','All','Muted']`.
   *
   * A single value rather than a list, because the three are mutually
   * exclusive readings of the same table. Defaults to `open`, which is the
   * prototype's own first-pressed segment and the only one an inbox should
   * open on.
   */
  segment: AlertSegment
  /**
   * The pressed severity toggles on the alert inbox. EMPTY IS EVERY SEVERITY,
   * exactly as it is for `channels` — see that field's note. Clear must arrive
   * here as `[]`, never as all three ids.
   */
  severities: AlertSeverity[]
  /**
   * The pressed source toggles. Empty is every source, same rule.
   *
   * All five are RENDERED whatever is in here (ruling N-R1); this is only
   * which of them are pressed.
   */
  sources: AlertSource[]
}

/**
 * Yesterday, not today. An owner opening the dashboard in the morning wants the
 * day that finished, not the one that has barely started — a half-day of
 * figures compared against a whole one reads as a collapse.
 */
/** Exported for the sign-in door, which names the window this default opens. */
export const DEFAULT_PRESET: PresetId = "yesterday"
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

/**
 * `day=2026-08-29` — the week picker's selection.
 *
 * Anything that is not a real calendar day is DROPPED, the same way
 * `readChannels` drops a channel it does not recognise: this string is user
 * input, a stale link from last month is a normal thing to click, and the
 * adapter already falls back to today for a day the week does not hold. It is
 * NOT validated against "this week" here — that is the adapter's decision, and
 * this module has no idea which week a caller means.
 *
 * `parseIsoDay` rather than a bare regex, so `2026-02-31` is rejected rather
 * than rolled into March.
 */
/**
 * `sev=CRITICAL,WATCH` / `src=ANOMALY_EVENT` — the inbox's two toggle rows.
 *
 * The same shape as `readChannels` and for the same reason: anything
 * unrecognised is DROPPED rather than thrown on, because a link from before an
 * enum member was renamed is a normal thing to click and an inbox that 500s on
 * a stale query string is worse than one that shows everything.
 */
function readIdList<T extends string>(
  params: URLSearchParams,
  key: string,
  guard: (v: string) => v is T,
): T[] {
  const raw = params.get(key)
  if (raw === null || raw === "") return []
  const out: T[] = []
  for (const part of raw.split(",")) {
    const id = part.trim()
    if (guard(id) && !out.includes(id)) out.push(id)
  }
  return out
}

function readDay(params: URLSearchParams): string | null {
  const raw = params.get("day")
  if (raw === null || raw === "") return null
  return parseIsoDay(raw) === null ? null : raw
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
    day: readDay(params),
    segment: (() => {
      const raw = params.get("seg")
      return raw !== null && isAlertSegment(raw) ? raw : DEFAULT_ALERT_SEGMENT
    })(),
    severities: readIdList(params, "sev", isAlertSeverity),
    sources: readIdList(params, "src", isAlertSource),
  }
}

/**
 * Writes only what changed, and DROPS anything at its default so a shared URL
 * stays short and readable. `?range=d30` beats
 * `?range=d30&cmp=prev&store=` for a link someone pastes into a message.
 */
export function writeCounterParams(
  current: URLSearchParams,
  next: Partial<
    Pick<
      CounterParams,
      "comparisonId" | "storeId" | "channels" | "search" | "day" | "segment" | "severities" | "sources"
    >
  > & {
    presetId?: PresetId
    /**
     * WHICH ALERT THE INBOX HAS OPEN, or null to close it.
     *
     * Not on `CounterParams`, and deliberately: that interface is the shape
     * every Counter page reads through `readCounterParams`, and one page's
     * selection is not a window, a store or a filter. The alerts client reads
     * this key straight off the `URLSearchParams` it already holds.
     *
     * It is in the URL rather than in component state for the reason every
     * other control on that page is: a selection that survives a reload and
     * travels in a link. "This is the one I mean" is a sendable sentence.
     */
    alert?: string | null
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
  /*
   * The picked day is WRITTEN, never dropped at a default — there is no
   * default day to drop it at. "Today" is not a value this module can compute
   * (it has no clock and takes no `today` here), and a picker that cleared
   * the key when the reader pressed today would hand back a link that means
   * "whatever day you open this on" rather than the day that was pressed.
   * `null` clears it, which is how a caller says "back to today".
   */
  if (next.day !== undefined) {
    if (next.day === null) out.delete("day")
    else out.set("day", next.day)
  }
  // Dropped when nothing is selected, so a link to the queue is a link to the
  // queue rather than to whichever row someone last looked at.
  if (next.alert !== undefined) {
    if (next.alert === null) out.delete("alert")
    else out.set("alert", next.alert)
  }
  /*
   * The alert inbox's three keys, all dropped at their default so a shared
   * link stays short — and, for the two lists, so `?sev=` and no `sev` key at
   * all cannot come to mean different things. `readIdList` reads both as "no
   * toggle pressed", which IS "every severity"; writing all three ids instead
   * would be a filter, and Clear must never narrow.
   */
  if (next.segment !== undefined) {
    if (next.segment === DEFAULT_ALERT_SEGMENT) out.delete("seg")
    else out.set("seg", next.segment)
  }
  if (next.severities !== undefined) {
    if (next.severities.length === 0) out.delete("sev")
    else out.set("sev", next.severities.join(","))
  }
  if (next.sources !== undefined) {
    if (next.sources.length === 0) out.delete("src")
    else out.set("src", next.sources.join(","))
  }

  return out
}
