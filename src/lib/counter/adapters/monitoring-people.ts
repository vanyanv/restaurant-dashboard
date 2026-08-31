import { prisma } from "@/lib/prisma"
import { count, pct } from "@/lib/counter/format"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, MListRow, Row } from "@/components/counter"

/**
 * Two more monitoring tabs — `P.monpeople` and `P.monactivity`
 * (`docs/counter/counter-prototype.html`).
 *
 * ## People: the tab's own question has an answer, and it is no
 *
 * `P.monpeople`'s note is *"Owner engagement: whether the thing gets opened,
 * and which pages earn their place."* Measured:
 *
 *   demo@restaurantos.com   DEVELOPER   4,531 views   261 over 3s
 *   chris@chrisneddys.com   OWNER           2 views     0 over 3s
 *
 * **The owner has opened this product twice, both on 24 August, four seconds
 * apart.** Every other page view and all 703 sign-ins in the last thirty days
 * are the developer account. A tab that reports "48 sessions" without saying
 * whose they are answers a different question from the one it asks.
 *
 * ## And the dwell needs filtering before it means anything
 *
 * 4,154 of 4,533 views have a dwell under one second and the median is **5
 * milliseconds**. Those are router transitions and prefetches, not readings.
 * Filtered to three seconds and up the routes become sensible — `/dashboard`
 * 97 views at a 19s median, `/dashboard/chat` 11 at 110s — so the signal is
 * recoverable rather than absent.
 *
 * The page reports both numbers. A view count that includes 5ms rows is a
 * count of navigations, and calling it engagement is the mistake this tab
 * exists to prevent.
 */

/** Below this, a page view is a navigation rather than a reading. */
const HUMAN_DWELL_MS = 3000
/** The window both tabs report over. */
const WINDOW_DAYS = 30
/** Rows a table prints. */
const TABLE_ROWS = 8
const PHONE_ROWS = 4

/* ── People ───────────────────────────────────────────────────────────── */

export interface PeopleHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

/**
 * `P.monpeople`'s "Sessions" chart, which is a chart of READINGS here.
 *
 * This product records no session boundary — there is no start, no end and no
 * idle timeout anywhere in the schema — so a sessions series would have to be
 * invented from page views by picking a gap length, and the gap length would
 * decide the answer. What IS recorded is a dwell per view, and the page
 * already argues (see the docblock above) that a view under three seconds is a
 * navigation rather than a reading. So the bars are readings per day: the same
 * filter the table below uses, drawn over time.
 *
 * A day with no rows draws a zero rather than being dropped. Four of the
 * window's thirty days have none, and "nobody opened it" is the answer this
 * tab is asking for — note 33's zero-is-a-reading, on the one page where the
 * zeros are the finding.
 *
 * It does NOT separate the accounts, and the note says so in a sentence rather
 * than in a second series: the owner contributes two views to one day of the
 * thirty and neither lasted ten milliseconds, so an owner series would be a
 * flat line at zero drawn across a developer's working month. The strip
 * carries that comparison as two figures, which is the shape it deserves.
 */
export interface PeopleReadings {
  chart: ChartSpec
  meta: string
  note: string
}

export interface PeoplePages {
  rows: Row[]
  phoneRows: MListRow[]
  meta: string
  note: string
}

/**
 * `P.monpeople`'s "What this tells you" — the verdict, in prose.
 *
 * The prototype's is two paragraphs: a claim in body type, and a caveat in
 * mono. Ours keeps that shape, and it is where "Who opens it" went. That
 * section was a six-column table with TWO rows — this installation has two
 * accounts — which is a sentence wearing a table's clothes, and the sentence
 * is the strongest thing on the page: the owner has opened this product twice
 * and neither view lasted ten milliseconds. The prototype puts its
 * strongest claim here too.
 */
export interface PeopleVerdict {
  lead: string
  note: string
}

export interface PeopleSections {
  headline: SectionData<PeopleHeadline>
  readings: SectionData<PeopleReadings>
  pages: SectionData<PeoplePages>
  verdict: SectionData<PeopleVerdict>
}

interface Person {
  email: string
  role: string
  views: number
  humanViews: number
  signIns: number
  first: Date | null
  last: Date | null
}

interface PeopleData {
  people: Person[]
  totalViews: number
  humanViews: number
  medianDwellMs: number | null
  routes: Array<{ route: string; views: number; medianS: number }>
  /** One row per day IN THE WINDOW, zeros included — see `PeopleReadings`. */
  daily: Array<{ day: Date; views: number; human: number }>
}

async function loadPeople(): Promise<PeopleData> {
  const [people, dwell, routes, daily] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        email: string | null
        role: string | null
        views: number
        human: number
        first: Date | null
        last: Date | null
        signins: number
      }>
    >`
      SELECT u.email, u.role::text AS role,
             COUNT(p.id)::int AS views,
             COUNT(p.id) FILTER (WHERE p."dwellMs" >= ${HUMAN_DWELL_MS})::int AS human,
             MIN(p."enteredAt") AS first, MAX(p."enteredAt") AS last,
             (SELECT COUNT(*)::int FROM "LoginEvent" l
               WHERE l."userId" = u.id AND l.kind = 'SIGN_IN'
                 AND l."createdAt" >= NOW() - MAKE_INTERVAL(days => ${WINDOW_DAYS})) AS signins
      FROM "User" u
      LEFT JOIN "PageView" p ON p."userId" = u.id
      GROUP BY u.id, u.email, u.role
      ORDER BY 3 DESC`,
    prisma.$queryRaw<Array<{ total: number; human: number; median: number | null }>>`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "dwellMs" >= ${HUMAN_DWELL_MS})::int AS human,
             (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "dwellMs"))::float AS median
      FROM "PageView"`,
    prisma.$queryRaw<Array<{ route: string; views: number; median_s: number }>>`
      SELECT route, COUNT(*)::int AS views,
             ((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "dwellMs")) / 1000.0)::float AS median_s
      FROM "PageView"
      WHERE "dwellMs" >= ${HUMAN_DWELL_MS}
      GROUP BY 1 ORDER BY 2 DESC`,
    // `generate_series` rather than a GROUP BY, so a day nobody opened it is a
    // zero in the series instead of a missing bar. See `PeopleReadings`.
    prisma.$queryRaw<Array<{ day: Date; views: number; human: number }>>`
      SELECT d.day::date AS day,
             COUNT(p.id)::int AS views,
             COUNT(p.id) FILTER (WHERE p."dwellMs" >= ${HUMAN_DWELL_MS})::int AS human
      FROM generate_series(
             date_trunc('day', NOW() - MAKE_INTERVAL(days => ${WINDOW_DAYS - 1})),
             date_trunc('day', NOW()),
             '1 day') AS d(day)
      LEFT JOIN "PageView" p ON date_trunc('day', p."enteredAt") = d.day
      GROUP BY 1 ORDER BY 1`,
  ])

  return {
    people: people.map((p) => ({
      email: p.email ?? "unknown",
      role: p.role ?? "—",
      views: p.views,
      humanViews: p.human,
      signIns: p.signins,
      first: p.first,
      last: p.last,
    })),
    totalViews: dwell[0]?.total ?? 0,
    humanViews: dwell[0]?.human ?? 0,
    medianDwellMs: dwell[0]?.median ?? null,
    routes: routes.map((r) => ({ route: r.route, views: r.views, medianS: r.median_s })),
    daily,
  }
}

const D = (d: Date | null) =>
  d === null
    ? "never"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

const secs = (s: number): string => (s < 60 ? `${s.toFixed(0)}s` : `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`)

function peopleHeadlineOf(d: PeopleData): PeopleHeadline {
  const owner = d.people.find((p) => p.role === "OWNER")
  const others = d.people.filter((p) => p.role !== "OWNER")

  const ownerCell: FigureProps = {
    label: "Owner page views",
    value: owner ? count(owner.views) : "—",
    // The tab's whole question, answered in a delta.
    delta: owner
      ? owner.views === 0
        ? "the owner has never opened it"
        : `${count(owner.humanViews)} lasted over ${count(HUMAN_DWELL_MS / 1000)}s · last ${D(owner.last)}`
      : "no owner account",
    deltaTone: "is-down",
  }
  const realCell: FigureProps = {
    label: "Views over 3s",
    value: count(d.humanViews),
    delta: `of ${count(d.totalViews)} · median dwell ${d.medianDwellMs === null ? "—" : `${Math.round(d.medianDwellMs)}ms`}`,
    deltaTone: "is-down",
  }

  return {
    cells: [
      ownerCell,
      {
        label: "Developer views",
        value: count(others.reduce((t, p) => t + p.views, 0)),
        delta: `${count(others.reduce((t, p) => t + p.signIns, 0))} sign-ins in ${count(WINDOW_DAYS)} days`,
        deltaTone: "is-flat",
      },
      realCell,
      {
        label: "Pages opened",
        value: count(d.routes.length),
        delta: `distinct routes with a real reading`,
        deltaTone: "is-flat",
      },
    ],
    phoneCells: [ownerCell, realCell],
  }
}

/** The readings, by day — see `PeopleReadings`. */
function peopleReadingsOf(d: PeopleData): PeopleReadings {
  const human = d.daily.map((r) => r.human)
  const quiet = d.daily.filter((r) => r.human === 0).length
  const busiest = d.daily.reduce<{ day: Date; human: number } | null>(
    (m, r) => (m === null || r.human > m.human ? r : m),
    null,
  )

  return {
    chart: {
      type: "bars",
      h: 148,
      zero: true,
      labels: d.daily.map((r) =>
        new Date(r.day).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
      ),
      series: [{ name: "Readings", color: "var(--ink)", data: human }],
      alt: `Page views over ${HUMAN_DWELL_MS / 1000} seconds, by day`,
    },
    meta: `last ${count(WINDOW_DAYS)} days`,
    note:
      `Readings, not sessions: nothing in this schema records where one visit ends and the ` +
      `next begins, so a session count would be a gap length somebody chose. A view over ` +
      `${count(HUMAN_DWELL_MS / 1000)} seconds is what the record can actually vouch for. ` +
      (busiest === null
        ? ""
        : `The busiest day read ${count(busiest.human)}, and ${count(quiet)} of the ` +
          `${count(WINDOW_DAYS)} drew nothing at all. `) +
      `Both accounts are in one series — the owner contributes two views to one of these ` +
      `days, so a second line would be zero everywhere it could be drawn.`,
  }
}

/** The verdict — see `PeopleVerdict`. */
function peopleVerdictOf(d: PeopleData): PeopleVerdict {
  const owner = d.people.find((p) => p.role === "OWNER")
  const others = d.people.filter((p) => p.role !== "OWNER")
  const devViews = others.reduce((t, p) => t + p.views, 0)
  const devSignIns = others.reduce((t, p) => t + p.signIns, 0)

  const lead =
    owner === undefined
      ? "No owner account exists on this installation, so nothing here is a reading by the person the product is for."
      : owner.views === 0
        ? "The owner has never opened this product. Every page view in the record is the developer account, which makes every figure on this page a measurement of the person who built it."
        : `The owner has opened this product ${count(owner.views)} ` +
          `${owner.views === 1 ? "time" : "times"}, on ${D(owner.first)}, and ` +
          `${
            owner.humanViews === 0
              ? "not one of those views lasted three seconds"
              : `${count(owner.humanViews)} lasted longer than three seconds`
          }. Everything else on this page is the developer account.`

  return {
    lead,
    note:
      `${count(devViews)} developer views and ${count(devSignIns)} sign-ins in ` +
      `${count(WINDOW_DAYS)} days, much of it automated. This is the whole reason the tab ` +
      `names the accounts rather than totalling them: a figure that adds the two answers a ` +
      `different question from the one it asks.` +
      (owner && owner.views > 0 && owner.humanViews === 0
        ? ` The beacon itself is unverified in a real browser — the owner's two views recorded ` +
          `dwells of six and five milliseconds, which is the shape of a page that was opened ` +
          `and closed, and also the shape of a beacon that fires before it can measure.`
        : ""),
  }
}

/**
 * Which pages earn their place — counted only from views a human could have
 * produced.
 *
 * The unfiltered table is a count of NAVIGATIONS: 4,154 of 4,533 rows are
 * under a second and the median is 5ms. Filtered to three seconds the routes
 * become legible — `/dashboard` 97 views at a 19s median, `/dashboard/chat` 11
 * at 110s — which is the difference between a router transition and somebody
 * reading.
 */
function peoplePagesOf(d: PeopleData): PeoplePages {
  const shown = d.routes.slice(0, TABLE_ROWS)
  const total = d.routes.reduce((t, r) => t + r.views, 0)

  return {
    rows: shown.map((r) => ({
      key: r.route,
      cells: {
        page: r.route,
        views: count(r.views),
        median: secs(r.medianS),
        share: total > 0 ? pct((r.views / total) * 100, { scaled: true }) : "—",
      },
    })),
    phoneRows: shown.slice(0, PHONE_ROWS).map((r) => ({
      key: r.route,
      title: r.route,
      detail: `${secs(r.medianS)} median`,
      value: count(r.views),
      note: total > 0 ? pct((r.views / total) * 100, { scaled: true }) : "—",
      noteTone: "up" as const,
    })),
    meta: `${count(d.routes.length)} routes · views over ${count(HUMAN_DWELL_MS / 1000)}s only`,
    note:
      `Counted from the ${count(d.humanViews)} views that lasted more than ` +
      `${count(HUMAN_DWELL_MS / 1000)} seconds, not all ${count(d.totalViews)}. The median dwell ` +
      `across everything is ${d.medianDwellMs === null ? "—" : `${Math.round(d.medianDwellMs)}ms`}, ` +
      `which is a router transition rather than a reading; including those would make this a ` +
      `table of navigations and call it attention.`,
  }
}

export function getPeopleSectionPromises(): StreamedSections<PeopleSections> {
  const dataP = classify(() => loadPeople(), {
    retryAction: "retryPeople",
    isEmpty: (d) => d.people.length === 0,
    emptyReason: "no_match",
  })
  const s = <T,>(f: (d: PeopleData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryPeople")
  return {
    headline: s(peopleHeadlineOf),
    readings: s(peopleReadingsOf),
    pages: s(peoplePagesOf),
    verdict: s(peopleVerdictOf),
  }
}

export async function getPeopleSections(): Promise<PeopleSections> {
  return awaitSections(getPeopleSectionPromises())
}

/* ── Activity ─────────────────────────────────────────────────────────── */

export interface ActivityHeadline {
  verdict: string
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface ActivityErrors {
  chart: ChartSpec
  rows: Row[]
  phoneRows: MListRow[]
  meta: string
  note: string
}

export interface ActivityStores {
  rows: Row[]
  meta: string
  note: string
}

/**
 * `P.monactivity`'s "What happened · last 24 hours" — the job feed.
 *
 * One row per `JobRun`, newest first. The prototype's rows are invented and
 * uniformly cheerful; these are the real ones, and a run that wrote nothing or
 * carried an `errorMessage` says so.
 */
export interface ActivityFeed {
  rows: Array<{
    key: string
    /** `.tm` — how long ago, in the prototype's compact form ("12m", "6h"). */
    ago: string
    title: string
    detail: string
    /** `.fd--good` / `--warn` / `--bad`. */
    tone: "good" | "warn" | "bad"
  }>
  meta: string
  note: string
}

export interface ActivitySections {
  headline: SectionData<ActivityHeadline>
  errors: SectionData<ActivityErrors>
  stores: SectionData<ActivityStores>
  feed: SectionData<ActivityFeed>
}

interface ActivityFeedRow {
  id: string
  jobName: string
  startedAt: Date
  rowsWritten: number | null
  durationMs: number | null
  errorMessage: string | null
}

interface ActivityData {
  feed: ActivityFeedRow[]
  errors24h: number
  byHour: number[]
  recent: Array<{ at: Date; source: string; message: string }>
  syncRuns24h: number
  syncFailed24h: number
  stores: Array<{ name: string; stage: string | null; lastOrder: Date | null; orders30d: number }>
}

async function loadActivity(): Promise<ActivityData> {
  const [errors, byHour, recent, syncs, stores, feed] = await Promise.all([
    prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM "ErrorEvent"
      WHERE "occurredAt" >= NOW() - INTERVAL '24 hours'`,
    prisma.$queryRaw<Array<{ hr: number; n: number }>>`
      SELECT EXTRACT(HOUR FROM "occurredAt")::int AS hr, COUNT(*)::int AS n
      FROM "ErrorEvent" WHERE "occurredAt" >= NOW() - INTERVAL '24 hours'
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<Array<{ at: Date; source: string; message: string }>>`
      SELECT "occurredAt" AS at, source, message FROM "ErrorEvent"
      ORDER BY "occurredAt" DESC LIMIT 8`,
    prisma.$queryRaw<Array<{ runs: number; failed: number }>>`
      SELECT COUNT(*)::int AS runs,
             COUNT(*) FILTER (WHERE status = 'FAILURE')::int AS failed
      FROM "ExternalSignalSyncRun" WHERE "startedAt" >= NOW() - INTERVAL '24 hours'`,
    prisma.$queryRaw<
      Array<{ name: string; stage: string | null; last_order: Date | null; orders: number }>
    >`
      SELECT s.name, s."lifecycleStage"::text AS stage,
             (SELECT MAX(o."referenceTimeLocal") FROM "OtterOrder" o WHERE o."storeId" = s.id) AS last_order,
             (SELECT COUNT(*)::int FROM "OtterOrder" o WHERE o."storeId" = s.id
               AND o."referenceTimeLocal" >= NOW() - INTERVAL '30 days') AS orders
      FROM "Store" s ORDER BY s.name`,
    prisma.$queryRaw<ActivityFeedRow[]>`
      SELECT id, "jobName", "startedAt", "rowsWritten", "durationMs", "errorMessage"
        FROM "JobRun"
       WHERE "startedAt" >= NOW() - INTERVAL '24 hours'
       ORDER BY "startedAt" DESC
       LIMIT 12`,
  ])

  const hours = Array.from({ length: 24 }, (_, i) => byHour.find((h) => h.hr === i)?.n ?? 0)

  return {
    feed,
    errors24h: errors[0]?.n ?? 0,
    byHour: hours,
    recent,
    syncRuns24h: syncs[0]?.runs ?? 0,
    syncFailed24h: syncs[0]?.failed ?? 0,
    stores: stores.map((s) => ({
      name: s.name,
      stage: s.stage,
      lastOrder: s.last_order,
      orders30d: s.orders,
    })),
  }
}

/** "12m", "6h", "1d" — the prototype's compact `.tm` column. */
function agoOf(at: Date): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000))
  if (mins < 60) return `${mins}m`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / 1440)}d`
}

/**
 * The job feed. Real runs, so unlike the prototype's six invented rows these
 * can be dull — and a dull feed IS the reading on a page whose whole question
 * is "did anything break".
 *
 * A run that failed is `bad`. A run that succeeded and wrote NOTHING is
 * `warn`, not `good`: a sync that completes over zero rows is the shape the
 * cron-cadence problem takes, and colouring it green would hide exactly the
 * thing this page is opened to find.
 */
function activityFeedOf(d: ActivityData): ActivityFeed {
  const zero = d.feed.filter((r) => r.errorMessage === null && (r.rowsWritten ?? 0) === 0).length
  const failed = d.feed.filter((r) => r.errorMessage !== null).length

  return {
    rows: d.feed.map((r) => {
      const rows = r.rowsWritten ?? 0
      const secs = r.durationMs === null ? null : r.durationMs / 1000
      return {
        key: r.id,
        ago: agoOf(r.startedAt),
        title: r.jobName,
        detail:
          r.errorMessage !== null
            ? r.errorMessage.slice(0, 90)
            : `${count(rows)} row${rows === 1 ? "" : "s"}` +
              (secs === null ? "" : ` · ${secs < 10 ? secs.toFixed(1) : Math.round(secs)}s`),
        tone: r.errorMessage !== null ? "bad" : rows === 0 ? "warn" : "good",
      }
    }),
    meta: "last 24 hours",
    note:
      d.feed.length === 0
        ? "No job has run in the last twenty-four hours, which is itself the finding."
        : `${count(d.feed.length)} run${d.feed.length === 1 ? "" : "s"} in the window` +
          (failed > 0 ? `, ${count(failed)} failed` : ", none failed") +
          (zero > 0
            ? `, and ${count(zero)} finished having written nothing — a sync that completes ` +
              `over zero rows looks like success and is the shape a missed schedule takes.`
            : "."),
  }
}

/**
 * The verdict line, which is the tab's own idea and a good one.
 *
 * `P.monactivity`'s note: *"Seven panels in the app, which is too many to scan
 * for the only question this tab is ever opened with. So it opens with the
 * answer in a sentence, and the panels are the working."*
 *
 * The sentence is composed rather than fixed, because on this account the
 * answer is not the prototype's "nothing here needs you" — the errors are the
 * cron watchdog reporting stale syncs, and that does.
 */
function activityHeadlineOf(d: ActivityData): ActivityHeadline {
  const silent = d.stores.filter((s) => s.orders30d === 0)
  const preOpen = silent.filter((s) => s.stage === "pre_open")
  const unexplained = silent.filter((s) => s.stage !== "pre_open")
  const watchdog = d.recent.filter((r) => r.source.startsWith("cron.")).length

  const verdict =
    d.errors24h === 0 && d.syncFailed24h === 0
      ? `Nothing failed in the last 24 hours. ${count(d.syncRuns24h)} sync runs, no errors, and every trading store reported.`
      : `${count(d.errors24h)} ${d.errors24h === 1 ? "error" : "errors"} in 24 hours and ` +
        `${count(d.syncFailed24h)} of ${count(d.syncRuns24h)} sync runs failed. ` +
        (watchdog > 0
          ? `The errors are the cron watchdog, not the application — it is reporting that jobs are overdue, which means the failures above are not new. `
          : "") +
        (unexplained.length > 0
          ? `${unexplained.map((s) => s.name).join(", ")} reported no orders in thirty days and is not pre-open.`
          : preOpen.length > 0
            ? `${count(preOpen.length)} ${preOpen.length === 1 ? "store is" : "stores are"} silent because ${preOpen.length === 1 ? "it has" : "they have"} not opened.`
            : "")

  const errorCell: FigureProps = {
    label: "Errors, 24h",
    value: count(d.errors24h),
    delta: watchdog === d.recent.length && d.recent.length > 0 ? "all the cron watchdog" : "logged",
    deltaTone: d.errors24h > 0 ? "is-down" : "is-flat",
  }
  const silentCell: FigureProps = {
    label: "Silent stores",
    value: count(silent.length),
    delta:
      unexplained.length > 0
        ? `${unexplained.map((s) => s.name).join(", ")} — not pre-open`
        : `${count(preOpen.length)} pre-open`,
    deltaTone: unexplained.length > 0 ? "is-down" : "is-flat",
  }

  return {
    verdict,
    cells: [
      errorCell,
      {
        label: "Sync runs, 24h",
        value: count(d.syncRuns24h),
        delta:
          d.syncFailed24h === 0
            ? "all clean"
            : `${count(d.syncFailed24h)} failed`,
        deltaTone: d.syncFailed24h > 0 ? "is-down" : "is-flat",
      },
      silentCell,
      {
        label: "Orders, 30d",
        value: count(d.stores.reduce((t, s) => t + s.orders30d, 0)),
        delta: `across ${count(d.stores.filter((s) => s.orders30d > 0).length)} trading`,
        deltaTone: "is-flat",
      },
    ],
    phoneCells: [errorCell, silentCell],
  }
}

function activityErrorsOf(d: ActivityData): ActivityErrors {
  const T = (at: Date) =>
    at.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    })

  return {
    chart: {
      type: "bars",
      h: 142,
      zero: true,
      labels: Array.from({ length: 24 }, (_, i) => `${i}`),
      series: [{ name: "Errors", color: "var(--ink)", data: d.byHour }],
      alt: "Errors by hour of the last day",
    },
    rows: d.recent.map((r, i) => ({
      key: `${r.at.toISOString()}:${i}`,
      cells: {
        when: T(r.at),
        where: r.source,
        what: r.message.slice(0, 70),
      },
    })),
    phoneRows: d.recent.slice(0, PHONE_ROWS).map((r, i) => ({
      key: `${r.at.toISOString()}:${i}`,
      title: r.source,
      detail: r.message.slice(0, 50),
      value: T(r.at),
      noteTone: "down" as const,
    })),
    meta: `${count(d.errors24h)} in 24 hours · ${count(d.recent.length)} most recent`,
    note:
      d.recent.every((r) => r.source.startsWith("cron."))
        ? `Every one is the cron watchdog rather than a request that failed. It reports jobs ` +
          `that are overdue or have failed repeatedly, so these are a symptom of the syncs ` +
          `rather than errors in their own right — the same story the shell's subsystem table ` +
          `tells from the other end.`
        : `A mix of application errors and watchdog reports.`,
  }
}

function activityStoresOf(d: ActivityData): ActivityStores {
  const silent = d.stores.filter((s) => s.orders30d === 0)

  return {
    rows: d.stores.map((s) => ({
      key: s.name,
      cells: {
        store: s.name,
        stage: s.stage === "ready" ? "Trading" : { v: s.stage ?? "—", cls: "hot" },
        last: s.lastOrder === null ? { v: "never", cls: "hot" } : D(s.lastOrder),
        orders: s.orders30d === 0 ? { v: "none", cls: "hot" } : count(s.orders30d),
      },
    })),
    meta: `${count(d.stores.length)} stores · 30 days`,
    note:
      silent.length === 0
        ? `Every store reported orders in the last thirty days.`
        : `${silent.map((s) => s.name).join(", ")} reported nothing. ` +
          (silent.every((s) => s.stage === "pre_open")
            ? `Both are pre-open, so silence is the expected reading rather than a sync that ` +
              `stopped — which is the distinction this panel exists to make.`
            : `At least one is not pre-open, which means a sync stopped rather than a store ` +
              `not having opened.`),
  }
}

export function getActivitySectionPromises(): StreamedSections<ActivitySections> {
  const dataP = classify(() => loadActivity(), {
    retryAction: "retryActivity",
    isEmpty: () => false,
    emptyReason: "no_match",
  })
  const s = <T,>(f: (d: ActivityData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryActivity")
  return {
    headline: s(activityHeadlineOf),
    errors: s(activityErrorsOf),
    stores: s(activityStoresOf),
    feed: s(activityFeedOf),
  }
}

export async function getActivitySections(): Promise<ActivitySections> {
  return awaitSections(getActivitySectionPromises())
}
