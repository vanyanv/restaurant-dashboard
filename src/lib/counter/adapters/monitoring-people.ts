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

export interface PeopleWho {
  rows: Row[]
  phoneRows: MListRow[]
  meta: string
  note: string
}

export interface PeoplePages {
  rows: Row[]
  meta: string
  note: string
}

export interface PeopleSections {
  headline: SectionData<PeopleHeadline>
  who: SectionData<PeopleWho>
  pages: SectionData<PeoplePages>
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
}

async function loadPeople(): Promise<PeopleData> {
  const [people, dwell, routes] = await Promise.all([
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

function peopleWhoOf(d: PeopleData): PeopleWho {
  const owner = d.people.find((p) => p.role === "OWNER")

  return {
    rows: d.people.map((p) => ({
      key: p.email,
      cells: {
        who: p.email,
        role: p.role,
        views: p.views === 0 ? { v: "none", cls: "hot" } : count(p.views),
        real: p.humanViews === 0 ? { v: "none", cls: "hot" } : count(p.humanViews),
        signins: count(p.signIns),
        last: p.last === null ? { v: "never", cls: "hot" } : D(p.last),
      },
    })),
    phoneRows: d.people.map((p) => ({
      key: p.email,
      title: p.email,
      detail: `${p.role} · ${count(p.signIns)} sign-ins`,
      value: count(p.views),
      note: p.humanViews === 0 ? "no real reading" : `${count(p.humanViews)} over 3s`,
      noteTone: p.humanViews === 0 ? "down" : "up",
    })),
    meta: `${count(d.people.length)} accounts · ${count(WINDOW_DAYS)} days of sign-ins`,
    note:
      owner === undefined
        ? `No owner account exists on this installation.`
        : owner.views === 0
          ? `The owner has never opened the product. Every page view in the record is the ` +
            `developer account.`
          : `The owner has opened it ${count(owner.views)} ` +
            `${owner.views === 1 ? "time" : "times"}, on ${D(owner.first)}, and ` +
            `${owner.humanViews === 0 ? "none of those views lasted three seconds" : `${count(owner.humanViews)} lasted longer than three seconds`}. ` +
            `Everything else here is the developer account, much of it automated — a sign-in ` +
            `count that does not separate the two answers a different question from the one this ` +
            `tab asks.`,
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
  return { headline: s(peopleHeadlineOf), who: s(peopleWhoOf), pages: s(peoplePagesOf) }
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

export interface ActivitySections {
  headline: SectionData<ActivityHeadline>
  errors: SectionData<ActivityErrors>
  stores: SectionData<ActivityStores>
}

interface ActivityData {
  errors24h: number
  byHour: number[]
  recent: Array<{ at: Date; source: string; message: string }>
  syncRuns24h: number
  syncFailed24h: number
  stores: Array<{ name: string; stage: string | null; lastOrder: Date | null; orders30d: number }>
}

async function loadActivity(): Promise<ActivityData> {
  const [errors, byHour, recent, syncs, stores] = await Promise.all([
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
  ])

  const hours = Array.from({ length: 24 }, (_, i) => byHour.find((h) => h.hr === i)?.n ?? 0)

  return {
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
  }
}

export async function getActivitySections(): Promise<ActivitySections> {
  return awaitSections(getActivitySectionPromises())
}
