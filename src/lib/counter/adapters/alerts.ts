import {
  getAlertInbox,
  type AlertInboxData,
  type InboxAlert,
} from "@/app/actions/alerts/inbox-actions"
import type { AlertSeverity, AlertSource, AlertStatus } from "@/generated/prisma/client"
import { ANOMALY_RELEVANCE_DAYS } from "@/lib/anomaly-window"
import {
  ALERT_SEVERITIES,
  ALERT_SOURCES,
  DEFAULT_ALERT_SEGMENT,
  alertSourceLabel,
  type AlertSegment,
} from "@/lib/counter/alert-filters"
import { isoDay, rangeTitle } from "@/lib/counter/date-range"
import { classify } from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { ChartSeries } from "@/lib/counter/chart-geometry"
import type { DeltaTone } from "@/components/counter/surface/figure"
import type { PillSeverity, TagTone } from "@/components/counter"

/**
 * The alert inbox's data, classified — "Open right now", on the desk and on
 * the phone (`P.alerts`, `docs/counter/counter-prototype.html:4771`).
 *
 * ## What the prototype draws here, and what the database can actually say
 *
 * More of this page's design is unbacked than on any other Counter surface, so
 * the measurements are written down rather than discovered again. Live
 * database, 2026-08-26:
 *
 * | Fact | Measured |
 * |---|---|
 * | Rows | 87, every one `ANOMALY_EVENT` |
 * | The other four sources | 0 rows each |
 * | Status | `OPEN` 77, `DISMISSED` 10, `ACKNOWLEDGED` 0, `EXPLAINED` 0 |
 * | Severity | `CRITICAL` 40, `WATCH` 46, `INFO` 1 |
 * | `body` / `explanation` | null on all 87 |
 * | History | 2026-08-17 onward, with NO rows on 08-19 and 08-20 |
 * | `acknowledgedAt` non-null | 10 — and all ten are the DISMISSED rows |
 * | `AlertPreference` | 0 rows |
 *
 * The prototype's strip reads "Acknowledged 12", "Muted 2 · by rule" and
 * "Median time to close 1.4 days ▼ 0.6 on last month". Almost none of that has
 * a source, and the four rulings below are what this file prints instead.
 *
 * - **N-R1** — all five source toggles render, each carrying its live count,
 *   and a zero-count toggle is disabled. See `alert-filters.ts`.
 * - **N-R2** — "Acknowledged" is counted from `status = ACKNOWLEDGED` and
 *   reads 0. NEVER from `acknowledgedAt`: ten rows carry that timestamp and
 *   every one is a DISMISSAL, so a count sourced there would report ten
 *   dismissals as ten acknowledgements — a figure that is not merely wrong but
 *   inverted, on the one cell an owner would read as "I have dealt with these".
 * - **N-R3** — the time-to-close median prints with NO month-over-month delta.
 *   There is no last month behind nine days of history, and the median that
 *   does exist is over DISMISSALS, so the cell says so.
 * - **N-R4/N-R5** — the muted list renders its table shell over zero rows,
 *   never the empty state: `.empty` is a landmark `P.alerts.desk` does not
 *   have, and an extra landmark is never forgiven by the fidelity gate.
 * - **N-R18** — the PHONE's second list holds what is CLOSED, not what is
 *   acknowledged, and is never empty. Scoped to `status = ACKNOWLEDGED` it
 *   held zero rows and drew a blank panel under its own heading, which is
 *   N-R4's shell rule applied where it does not work: `mlist` is a landmark
 *   and its `.mli`s are not, so a shell over nothing satisfies the STRUCTURE
 *   pass and fails the RENDERING one (no grid track, no text). The count that
 *   N-R2 protects is untouched — it is the strip cell and the `.msub`, both
 *   still `status = ACKNOWLEDGED`, both still 0.
 *
 * ## One load, and the page awaits it
 *
 * Unlike `getDecisionsView`'s nine independent queries, `getAlertInbox` is one
 * load — a `findMany`, a `groupBy` and two small scope reads, all concurrent —
 * and every section here is a projection of its single result. So both alerts
 * pages keep a single `await getAlertsSections(...)` and are named in
 * `AWAITED_SECTIONS_ALLOWED`. Splitting one result into seven promises that
 * settle in the same tick would be a picture of streaming rather than
 * streaming. The distinguishing question is how many INDEPENDENT QUERIES sit
 * behind the sections, not how many sections there are.
 */

/* ------------------------------------------------------------------ *
 * The shapes the two pages render
 * ------------------------------------------------------------------ */

/**
 * A strip cell, before it becomes a `Figure`.
 *
 * `delta` and `note` are separate fields and only one of them can be rendered
 * — `Figure` has exactly one slot (`.d`) between the value and the band, and
 * `.band` needs a `reference` this page has none of. Keeping them apart is
 * what lets ruling N-R3 be stated in the TYPE: `delta: null` means "there is
 * no comparison behind this figure", which is a different claim from "the
 * comparison is flat", and a single pre-formatted string could not tell the
 * two apart.
 */
export interface AlertStripCell {
  label: string
  value: string
  /** A real period-over-period move, or null when there is no period behind it. */
  delta: string | null
  deltaTone?: DeltaTone
  /** The prototype's qualifier — "2 need a decision", "by rule". Always present. */
  note: string
}

/** One toggle on either filter row. */
export interface AlertToggle {
  id: string
  label: string
  /** A `ct-` custom-property NAME, never a colour literal. Severities only. */
  tint?: string
  pressed: boolean
  /** Live rows behind this toggle, within the same store scope and horizon. */
  count: number
  /** No rows: the toggle renders, says `0`, and cannot be pressed (N-R1). */
  disabled: boolean
}

export interface AlertsFilters {
  severities: AlertToggle[]
  sources: AlertToggle[]
  /** The prototype's `5 of 17`. Pre-formatted. */
  count: string
  /** Whether anything is actually filtered — what gates `Clear filters`. */
  filtering: boolean
}

export interface AlertsRow {
  key: string
  /**
   * `Alert.id` — the same value as `key`, named separately because the page
   * now WRITES to this row and a write should not be addressed by something
   * whose contract is "unique within this render".
   */
  id: string
  severity: PillSeverity
  title: string
  /**
   * Null on all 87 live rows, and rendered as ABSENT rather than as an empty
   * line. A row that prints a blank paragraph under its title is worse than
   * one that prints the title alone.
   */
  body: string | null
  source: AlertSource
  sourceLabel: string
  /** "2h ago", "1d ago" — the prototype's own Opened column. */
  opened: string
  status: AlertStatus
  statusLabel: string
  /**
   * Whether this row still has a decision in it.
   *
   * A boolean rather than leaving the page to read `status === "OPEN"`: the
   * page asks its own question ("can I close this?") instead of matching a
   * database enum, which is the same separation `statusLabel` and `statusTone`
   * already make for the words and the colour. `npm run tokens` also refuses
   * a `.status` comparison in a page, and it is right to — a surface that
   * branches on a stored enum is one that has to change every time the enum
   * grows a member.
   */
  closable: boolean
  /** `undefined` is the neutral grey `.mtag`; only OPEN is toned. */
  statusTone?: TagTone
}

export interface AlertsChart {
  labels: string[]
  series: ChartSeries[]
  /** The window the bars cover, for the section head. */
  meta: string
  /** The chart's accessible name. */
  alt: string
}

/** One `.mli` on the phone, before the severity tag becomes a `Tag`. */
export interface PhoneAlertRow {
  key: string
  /** `Alert.id` — what `?alert=` carries, and what the decision writes to. */
  id: string
  /** Whether this row still has a decision in it. See `AlertsRow.closable`. */
  closable: boolean
  title: string
  /** "Anomalies · 1d ago". Empty on the stated row — see `NOTHING_CLOSED`. */
  detail: string
  /**
   * Absent on the stated row and present on every alert.
   *
   * A row with no severity is a SENTENCE, not an alert judged as harmless,
   * and `listRow` gives it no `.mtag` at all rather than an "Info" pill that
   * would read as a fifth alert of the mildest kind.
   */
  severity?: PillSeverity
  /** The word inside the `.mtag`. */
  severityLabel?: string
  severityTone?: TagTone
}

export interface PhoneAlertList {
  rows: PhoneAlertRow[]
  /** The section head's qualifier — "6 of 77", "last 30 days". */
  meta: string
}

export interface PhoneAlertsHead {
  title: string
  /** The phone's own N-R2: "77 open · 0 acknowledged", live. */
  sub: string
}

export interface AlertsSections {
  strip: SectionData<AlertStripCell[]>
  filters: SectionData<AlertsFilters>
  table: SectionData<AlertsRow[]>
  chart: SectionData<AlertsChart>
  phoneHead: SectionData<PhoneAlertsHead>
  phoneOpen: SectionData<PhoneAlertList>
  /**
   * What is no longer open — N-R18. NOT "acknowledged": `status =
   * ACKNOWLEDGED` is 0 in this database and a list scoped to it renders a
   * blank panel under a heading. See the section builder.
   */
  phoneClosed: SectionData<PhoneAlertList>
}

export interface AlertsQuery {
  storeId?: string
  segment?: AlertSegment
  severities?: AlertSeverity[]
  sources?: AlertSource[]
  search?: string
  /** Injected by tests; the clock otherwise. */
  today?: Date
}

/* ------------------------------------------------------------------ *
 * Arithmetic
 * ------------------------------------------------------------------ */

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/**
 * The middle value, or the mean of the two middle values.
 *
 * Exported because it is the arithmetic behind a figure an owner reads as
 * "how long this takes me", and a figure like that gets a test of its own.
 * Returns null for an empty population rather than 0 — nothing closed is not
 * "closes instantly".
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * How long each closed alert took, in hours — and what population that was.
 *
 * A row counts as closed when it has BOTH a non-OPEN status and an
 * `acknowledgedAt`; a status without a timestamp cannot be measured and is
 * left out rather than assumed to have closed instantly. Negative and absurd
 * durations (a backfilled timestamp before the detection it belongs to) are
 * dropped for the same reason.
 *
 * `population` is what the cell's note is written from. Today every closed row
 * is a DISMISSAL, so the note reads "over 1 dismissal" — and it will say
 * something different on its own the day an alert is genuinely acknowledged,
 * rather than keeping a label that has quietly stopped being true.
 *
 * ONLY THE ROWS THE INBOX ACTUALLY LOADED, which is the horizon's own scope
 * and not the whole table. Measured 2026-08-27: `Alert` holds ten dismissals,
 * but nine of them occurred on 2026-07-25 and 2026-07-27 — outside
 * `anomalyHorizon()` — so one is in scope and the median is a median of one
 * number. That is why the cell NAMES ITS POPULATION SIZE rather than saying
 * "over dismissals": a median over n=1 is a single measurement wearing the
 * word median, and the count is the only thing that tells a reader which it
 * is looking at.
 */
/**
 * The rows that are no longer open, and can say WHEN they closed.
 *
 * ONE definition, read by the median cell and by the phone's second list
 * (N-R18). Two filters spelled out separately is how a page comes to print
 * "over 1 dismissal" beside a list of none.
 *
 * Both halves are load-bearing. A non-OPEN status without an `acknowledgedAt`
 * cannot be measured and is not evidence that anyone dealt with it; a
 * timestamp on an OPEN row is a backfill, not a closure.
 */
export function closedAlerts(alerts: InboxAlert[]): InboxAlert[] {
  return alerts.filter((a) => a.status !== "OPEN" && a.acknowledgedAt !== null)
}

export function timeToClose(alerts: InboxAlert[]): {
  hours: number[]
  population: { one: string; many: string }
} {
  const closed = closedAlerts(alerts)
  const hours: number[] = []
  for (const a of closed) {
    const ms = a.acknowledgedAt!.getTime() - a.detectedAt.getTime()
    if (ms >= 0) hours.push(ms / HOUR_MS)
  }
  const allDismissed = closed.length > 0 && closed.every((a) => a.status === "DISMISSED")
  return {
    hours,
    population: allDismissed
      ? { one: "dismissal", many: "dismissals" }
      : { one: "closed alert", many: "closed alerts" },
  }
}

/** `1.8 h` under two days, `2.1 d` beyond it, an em dash for nothing at all. */
export function durationWords(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "—"
  if (hours < 48) return `${hours.toFixed(1)} h`
  return `${(hours / 24).toFixed(1)} d`
}

/** The prototype's Opened column: `2h ago`, `1d ago`, `now`. */
export function agoWords(from: Date, now: Date): string {
  const ms = now.getTime() - from.getTime()
  if (ms < 0) return "now"
  if (ms < HOUR_MS) {
    const m = Math.floor(ms / 60_000)
    return m <= 0 ? "now" : `${m}m ago`
  }
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)}h ago`
  return `${Math.floor(ms / DAY_MS)}d ago`
}

/**
 * One bar per calendar day from the first alert ever opened to today,
 * INCLUDING the days on which nothing opened.
 *
 * This is the whole ruling. The live table has no rows at all on 08-19 and
 * 08-20; a series built by grouping the rows would return eight points for ten
 * days and the chart would draw a shorter week than happened — with the
 * remaining bars silently redistributed across the axis, so two quiet days
 * would read as a normal week rather than as two quiet days. A zero is a
 * measurement; a missing column is a different claim.
 *
 * Bucketed by `detectedAt` (when the alert OPENED, which is what the section
 * is titled) through `isoDay`, the same local-day key every other Counter
 * surface uses, so a bar and a table row cannot disagree about which day
 * something landed on.
 */
export function openedPerDay(
  alerts: InboxAlert[],
  today: Date,
): { labels: string[]; data: number[]; start: Date; end: Date } {
  const end = startOfDay(today)
  const opened = new Map<string, number>()
  let earliest = end
  for (const a of alerts) {
    const day = startOfDay(a.detectedAt)
    if (day.getTime() > end.getTime()) continue // a clock skew, not a day
    if (day.getTime() < earliest.getTime()) earliest = day
    const key = isoDay(day)
    opened.set(key, (opened.get(key) ?? 0) + 1)
  }

  const labels: string[] = []
  const data: number[] = []
  for (let d = new Date(earliest); d.getTime() <= end.getTime(); d = nextDay(d)) {
    const key = isoDay(d)
    labels.push(key.slice(5)) // MM-DD — the axis has no room for the year
    data.push(opened.get(key) ?? 0)
  }
  return { labels, data, start: earliest, end }
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

function nextDay(d: Date): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + 1)
  return out
}

/* ------------------------------------------------------------------ *
 * Builders
 * ------------------------------------------------------------------ */

const SEVERITY_RANK: Record<AlertSeverity, number> = { CRITICAL: 0, WATCH: 1, INFO: 2 }

const STATUS_WORDS: Record<AlertStatus, { label: string; tone?: TagTone }> = {
  OPEN: { label: "Open", tone: "bad" },
  ACKNOWLEDGED: { label: "Acknowledged" },
  EXPLAINED: { label: "Explained" },
  DISMISSED: { label: "Dismissed" },
}

/**
 * Which alerts a mute rule suppresses.
 *
 * `storeId: null` on a rule means every store and `target: null` means every
 * target — the schema's own comment. Zero rules today, so this returns an
 * empty list, and the "Muted" segment therefore renders a table shell over
 * zero rows (N-R4). It is a FILTER rather than a hard-coded `[]` so the day a
 * rule is written the segment starts showing what it caught, without anyone
 * remembering to come back here.
 */
export function mutedBy(alerts: InboxAlert[], rules: AlertInboxData["muteRules"]): InboxAlert[] {
  if (rules.length === 0) return []
  return alerts.filter((a) =>
    rules.some(
      (r) =>
        (r.storeId === null || r.storeId === a.storeId) &&
        (r.target === null || r.target === a.target),
    ),
  )
}

function segmentOf(
  data: AlertInboxData,
  segment: AlertSegment,
): InboxAlert[] {
  switch (segment) {
    case "open":
      return data.alerts.filter((a) => a.status === "OPEN")
    case "muted":
      return mutedBy(data.alerts, data.muteRules)
    case "all":
      return data.alerts
  }
}

function buildStrip(data: AlertInboxData): AlertStripCell[] {
  const { counts } = data
  const muted = mutedBy(data.alerts, data.muteRules)
  const { hours, population } = timeToClose(data.alerts)

  return [
    {
      label: "Open",
      value: String(counts.open),
      // No delta: the inbox is a horizon window, not a period, so there is no
      // previous window of the same length to have moved from.
      delta: null,
      deltaTone: counts.critical > 0 ? "is-down" : "is-flat",
      note:
        counts.critical > 0
          ? `${counts.critical} need a decision`
          : "none critical",
    },
    {
      // N-R2. `counts.acknowledged` is `status = ACKNOWLEDGED` and reads 0.
      label: "Acknowledged",
      value: String(counts.acknowledged),
      delta: null,
      deltaTone: "is-flat",
      note: counts.acknowledged === 0 ? "none yet" : `last ${ANOMALY_RELEVANCE_DAYS} days`,
    },
    {
      label: "Muted",
      value: String(muted.length),
      delta: null,
      deltaTone: "is-flat",
      note: data.muteRules.length === 0 ? "no rules set" : "by rule",
    },
    {
      // N-R3. The prototype's "▼ 0.6 on last month" has nothing behind it:
      // this table holds nine days.
      label: "Median time to close",
      value: durationWords(median(hours)),
      delta: null,
      note:
        hours.length === 0
          ? "nothing closed yet"
          : `over ${hours.length} ${hours.length === 1 ? population.one : population.many}`,
    },
  ]
}

function buildFilters(
  data: AlertInboxData,
  query: Required<Pick<AlertsQuery, "severities" | "sources" | "search">>,
  shown: number,
  total: number,
): AlertsFilters {
  const bySeverity = countBySeverity(data.alerts)

  return {
    severities: ALERT_SEVERITIES.map((s) => ({
      id: s.id,
      label: s.label,
      tint: s.tint,
      pressed: query.severities.length === 0 || query.severities.includes(s.id),
      count: bySeverity[s.id],
      disabled: bySeverity[s.id] === 0,
    })),
    /*
     * N-R1: five toggles, always, each with the number of rows behind it.
     * `data.bySource` is the groupBy's own tally over the whole store scope —
     * not a count of the rows currently in the table, which would drop to zero
     * the moment a search narrowed the list and make every toggle look dead.
     */
    sources: ALERT_SOURCES.map((s) => ({
      id: s.id,
      label: s.label,
      pressed: query.sources.length === 0 || query.sources.includes(s.id),
      count: data.bySource[s.id],
      disabled: data.bySource[s.id] === 0,
    })),
    count: `${shown} of ${total}`,
    filtering:
      query.severities.length > 0 || query.sources.length > 0 || query.search !== "",
  }
}

function countBySeverity(alerts: InboxAlert[]): Record<AlertSeverity, number> {
  const out: Record<AlertSeverity, number> = { CRITICAL: 0, WATCH: 0, INFO: 0 }
  for (const a of alerts) out[a.severity] += 1
  return out
}

function buildRows(alerts: InboxAlert[], today: Date): AlertsRow[] {
  return [...alerts]
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        b.detectedAt.getTime() - a.detectedAt.getTime(),
    )
    .map((a) => {
      const words = STATUS_WORDS[a.status]
      return {
        key: a.id,
        id: a.id,
        severity: a.severity,
        title: a.title,
        body: a.body,
        source: a.source,
        sourceLabel: alertSourceLabel(a.source),
        opened: agoWords(a.detectedAt, today),
        status: a.status,
        closable: a.status === "OPEN",
        statusLabel: words.label,
        statusTone: words.tone,
      }
    })
}

function buildChart(data: AlertInboxData, today: Date): AlertsChart {
  const { labels, data: series, start, end } = openedPerDay(data.alerts, today)
  return {
    labels,
    // `var(--ink)` is the prototype's own series colour, and a token reference
    // is the only colour a Counter file may name.
    series: [{ name: "Opened", color: "var(--ink)", data: series }],
    meta: rangeTitle({ start, end }),
    alt: "Alerts opened per day",
  }
}

/** The phone's six-row cap. Six `.mli`s is what fits above the fold. */
const PHONE_ROWS = 6

/**
 * The row a closed list carries when nothing has closed (N-R18).
 *
 * Not an `Empty`: that emits a `.empty` landmark `P.alerts.phone` does not
 * have, and an extra landmark is never forgiven. Not a blank panel either,
 * which is what the section drew before. `ANOMALY_RELEVANCE_DAYS` is named
 * rather than written out so the sentence cannot drift from the window the
 * inbox actually loaded.
 */
const NOTHING_CLOSED: PhoneAlertRow = {
  key: "nothing-closed",
  // Not an alert, so it carries no id and offers no decision — the same
  // reasoning that gives it no `.mtag`.
  id: "",
  closable: false,
  title: `Nothing closed in the last ${ANOMALY_RELEVANCE_DAYS} days`,
  detail: "",
}

function buildPhoneRows(alerts: InboxAlert[], today: Date): PhoneAlertRow[] {
  return buildRows(alerts, today)
    .slice(0, PHONE_ROWS)
    .map((r) => ({
      key: r.key,
      id: r.id,
      closable: r.closable,
      title: r.title,
      detail: `${r.sourceLabel} · ${r.opened}`,
      severity: r.severity,
      severityLabel:
        r.severity === "CRITICAL" ? "Critical" : r.severity === "WATCH" ? "Warning" : "Info",
      severityTone:
        r.severity === "CRITICAL" ? "bad" : r.severity === "WATCH" ? "warn" : undefined,
    }))
}

/* ------------------------------------------------------------------ *
 * The adapter
 * ------------------------------------------------------------------ */

const RETRY = "alerts"

/**
 * ONE `getAlertInbox` load, classified into seven sections.
 *
 * `includeResolved: true` always, and the segment is applied HERE rather than
 * in the loader: the strip's acknowledged/dismissed/median cells and the
 * chart's whole history are questions about the closed rows, so a loader
 * scoped to OPEN would leave three of the four strip cells with nothing to
 * read. The severity and source filters are likewise applied here so the five
 * source toggles can carry counts that do not collapse the moment one of them
 * is pressed.
 *
 * The loaded window is `PAGE_SIZE` rows (100) ordered severity-first. At 87
 * live rows nothing is truncated; when it is, the strip's COUNTS stay exact —
 * they come from the groupBy, not from this list — and the median becomes a
 * median over the loaded window, which is the honest limit of a paged read.
 *
 * An `unauthorized` result becomes a FAILED section, never an empty one. This
 * page is owner-gated (N-R8, unchanged), and a manager who reached it must not
 * be told the restaurant has no alerts.
 */
export async function getAlertsSections(input: AlertsQuery = {}): Promise<AlertsSections> {
  const today = input.today ?? new Date()
  const segment = input.segment ?? DEFAULT_ALERT_SEGMENT
  const query = {
    severities: input.severities ?? [],
    sources: input.sources ?? [],
    search: input.search?.trim() ?? "",
  }

  const loaded: SectionData<AlertInboxData> = await classify(
    async () => {
      const result = await getAlertInbox({
        storeId: input.storeId ?? null,
        includeResolved: true,
      })
      if (!result.ok) throw new Error("You do not have access to the alert inbox.")
      return result.data
    },
    { retryAction: RETRY },
  )

  /*
   * ONE derivation, mapped once. The segment, the filter and the whole load
   * are all needed by more than one section — the filter bar's count is the
   * table's own row count, and its total is the segment's — so they are
   * derived together and every section below is a projection of THIS. Deriving
   * them per section would be four chances for two figures about one list to
   * disagree.
   */
  const needle = query.search.toLowerCase()
  const view = mapReady(loaded, (d) => {
    const inSegment = segmentOf(d, segment)
    const rows = inSegment.filter(
      (a) =>
        (query.severities.length === 0 || query.severities.includes(a.severity)) &&
        (query.sources.length === 0 || query.sources.includes(a.source)) &&
        (needle === "" || a.title.toLowerCase().includes(needle)),
    )
    return { inbox: d, inSegment, rows }
  })

  return {
    strip: mapReady(view, (v) => buildStrip(v.inbox)),
    filters: mapReady(view, (v) =>
      buildFilters(v.inbox, query, v.rows.length, v.inSegment.length),
    ),
    /*
     * READY WITH ZERO ROWS, in every segment — never `empty` (N-R4/N-R5).
     *
     * Two reasons, and both are the prototype's rather than a preference.
     * `Empty` emits a `.empty` landmark that `P.alerts.desk` does not have,
     * and an extra landmark is never forgiven by the fidelity gate. And the
     * filter bar lives INSIDE this section, so an empty state would delete the
     * search box, the eight toggles and the Clear affordance that are the way
     * back out of a filter that matched nothing.
     */
    table: mapReady(view, (v) => buildRows(v.rows, today)),
    chart: mapReady(view, (v) => buildChart(v.inbox, today)),
    phoneHead: mapReady(view, ({ inbox: d }) => ({
      title: "Alerts",
      // The phone's own N-R2. The prototype says "3 open · 12 acknowledged";
      // live this reads "77 open · 0 acknowledged", and the second figure is
      // the STATUS count, not the ten dismissals carrying a timestamp.
      sub: `${d.counts.open} open · ${d.counts.acknowledged} acknowledged`,
    })),
    phoneOpen: mapReady(view, ({ inbox: d }) => {
      const open = d.alerts.filter((a) => a.status === "OPEN")
      const rows = buildPhoneRows(open, today)
      return {
        rows,
        meta: rows.length < open.length ? `${rows.length} of ${open.length}` : String(open.length),
      }
    }),
    /*
     * N-R18 — the second list holds what is CLOSED, and it is never empty.
     *
     * ## What it held before, and what that rendered
     *
     * `status === "ACKNOWLEDGED" || status === "EXPLAINED"`, which is 0 rows
     * in this database and 0 rows for as long as nothing in the product
     * writes either status. The section rendered its `mlist` shell over the
     * empty array — chosen so that `Empty` would not emit a `.empty` landmark
     * `P.alerts.phone` does not have — and what an owner saw was a heading
     * saying "Acknowledged · none yet" above a blank white panel. Photographed
     * at 390px before this change.
     *
     * The fidelity gate says the same thing in numbers: an `.mlist` with no
     * children computes `grid-template-columns: none` where the prototype's
     * computes one track, and carries no text where the prototype's carries
     * its rows'. Three rendering differences on a surface that is otherwise
     * 8 landmarks of 8. Avoiding the extra `.empty` did not make the section
     * render; it made it render nothing.
     *
     * ## What it holds now
     *
     * `closedAlerts` — the SAME predicate the median time-to-close cell reads,
     * so the list and the figure above it cannot disagree about which rows
     * count as dealt with. In scope today that is one dismissal (nine of the
     * account's ten fall outside `anomalyHorizon()`), so the list has a row
     * and the panel has content.
     *
     * ## N-R2 is untouched
     *
     * The heading is "Closed" and the meta NAMES the population from
     * `timeToClose` — "1 dismissal", and something else on its own the day an
     * alert is genuinely acknowledged. Nothing here calls a dismissal an
     * acknowledgement: the count that could is the desk strip's
     * `counts.acknowledged` and the phone subtitle's, both still `status =
     * ACKNOWLEDGED` and both still reading 0.
     *
     * ## The empty case still has to render
     *
     * A horizon with nothing closed in it is an ordinary week, not an alarm,
     * so it must not fail the gate — and it must not draw a blank panel
     * either. It gets ONE STATED ROW instead. That is the same rule
     * `movesFor` follows in the decisions adapter ("a day with no signal says
     * so rather than being left blank: an empty paragraph reads as a feature
     * that broke"), and a `.mli` is not a landmark, so saying it costs the
     * comparison nothing. It is a sentence, not an `Empty`, and not a control
     * that does nothing.
     */
    phoneClosed: mapReady(view, ({ inbox: d }) => {
      const closed = closedAlerts(d.alerts)
      const rows = buildPhoneRows(closed, today)
      const { one, many } = timeToClose(d.alerts).population
      if (rows.length === 0) return { rows: [NOTHING_CLOSED], meta: "none yet" }
      return {
        rows,
        meta:
          rows.length < closed.length
            ? `${rows.length} of ${closed.length}`
            : `${closed.length} ${closed.length === 1 ? one : many}`,
      }
    }),
  }
}
