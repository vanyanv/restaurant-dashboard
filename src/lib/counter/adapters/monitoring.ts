import { prisma } from "@/lib/prisma"
import { bytes, count, money, pct } from "@/lib/counter/format"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, ready, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, MListRow, Row } from "@/components/counter"

/**
 * Monitoring — `P.monitoring` (`docs/counter/counter-prototype.html`), the
 * shell only. The six tabs behind it are their own pages.
 *
 * "The one developer-facing surface."
 *
 * Measured before it was written:
 * `docs/counter/measurements/2026-08-28-monitoring.md`. Unlike inventory or
 * stock counts this cluster is well populated — eleven tables, none empty — so
 * the page's problem is not missing data. It is that the data says something
 * the prototype's strip does not.
 *
 * ## `Syncs · Healthy` is false, and two independent signals say so
 *
 * **PredictHQ has failed 21 of 21 runs in seven days**, and the errors are a
 * sequence rather than noise: five `HTTP 402 subscription expired`, then
 * sixteen `HTTP 401 unauthorized`. The subscription lapsed and then the
 * credential stopped working.
 *
 * Separately, every row in `ErrorEvent` is the cron watchdog reporting that
 * `otter.metrics.sync` is overdue and has failed three times consecutively.
 * Two systems that do not know about each other both say the syncs are
 * unhealthy.
 *
 * So the first cell reports the failure rate and names the provider, and a
 * DEAD integration is counted apart from a FLAKY one — open-meteo's three
 * failures are all SSL handshake timeouts, which is a different kind of thing
 * and recovers on its own. One number for both would flatten them.
 *
 * ## The developer-only claim it cannot enforce
 *
 * `P.monitoring`'s sub is "Developer only · not visible to the owner". There
 * is no gate in this product that can do that: `Role` holds only OWNER and
 * DEVELOPER and every access helper accepts both, so `hasOwnerAccess` is true
 * for everyone who can log in. The page says what it is rather than claiming a
 * restriction nothing enforces.
 */

/** A provider failing more than this share of runs is not flaky, it is down. */
const DEAD_PCT = 90
/** The window the strip reports over. */
const WINDOW_DAYS = 7

export interface MonitoringHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface MonitoringSubsystems {
  rows: Row[]
  phoneRows: MListRow[]
  meta: string
  note: string
}

export interface MonitoringEvents {
  rows: MListRow[]
  meta: string
  note: string
}

export interface MonitoringSections {
  headline: SectionData<MonitoringHeadline>
  subsystems: SectionData<MonitoringSubsystems>
  events: SectionData<MonitoringEvents>
  tabs: SectionData<MonitoringTabs>
}

export interface MonitoringTabs {
  rows: Row[]
  meta: string
}

/**
 * The bridge's sub-pages. Until now they were reachable only by typing the
 * URL: the legacy `TabStrip` that linked them belongs to the editorial shell
 * and is not rendered on a Counter page, and nothing replaced it. Six built
 * pages with no way in is a worse fault than anything on them.
 *
 * Static, so it needs no query and resolves with the shell.
 */
const TABS: Array<{ href: string; label: string; what: string }> = [
  {
    href: "/dashboard/admin/monitoring/ml",
    label: "Model health",
    what: "What the nightly forecast predicted, and whether it beat last week",
  },
  {
    href: "/dashboard/admin/monitoring/infrastructure",
    label: "Infrastructure",
    what: "Storage, scheduled jobs, and what actually broke",
  },
  {
    href: "/dashboard/admin/monitoring/activity",
    label: "Activity",
    what: "Errors and sync runs over the last day",
  },
  {
    href: "/dashboard/admin/monitoring/people",
    label: "People",
    what: "Who opens the product, and which pages earn their place",
  },
  {
    href: "/dashboard/admin/monitoring/costs",
    label: "Costs",
    what: "What the model and mail spend, by feature",
  },
  {
    href: "/dashboard/admin/monitoring/cache",
    label: "Cache",
    what: "Hit rates by prefix",
  },
  {
    href: "/dashboard/admin/monitoring/ingredient-audit",
    label: "Ingredients",
    what: "Match quality on the ingredient catalogue",
  },
]

function tabsOf(): MonitoringTabs {
  return {
    rows: TABS.map((t) => ({
      key: t.href,
      href: t.href,
      ariaLabel: t.label,
      cells: { tab: t.label, what: t.what },
    })),
    meta: `${TABS.length} pages`,
  }
}

export interface MonitoringInput {
  accountId: string
}

/* -- loading ---------------------------------------------------------- */

interface Provider {
  provider: string
  runs: number
  failed: number
  lastRun: Date | null
  avgMs: number | null
  lastError: string | null
}

interface Data {
  providers: Provider[]
  errors24h: number
  errors7d: number
  errorSources: Array<{ source: string; n: number }>
  cacheHits: number
  cacheMisses: number
  dbMb: number | null
  dbGrowthMb: number | null
  r2Mb: number | null
  r2Objects: number | null
  aiCost24h: number
  aiCost30d: number
  aiCalls24h: number
  recent: Array<{ what: string; detail: string; at: Date; ok: boolean }>
}

async function loadMonitoring(_input: MonitoringInput): Promise<Data> {
  const [providers, errors, errorSources, cache, db, r2, ai, recentRuns, recentErrors] =
    await Promise.all([
      prisma.$queryRaw<
        Array<{
          provider: string
          runs: number
          failed: number
          last_run: Date | null
          avg_ms: number | null
          last_error: string | null
        }>
      >`
        SELECT provider,
               COUNT(*)::int AS runs,
               COUNT(*) FILTER (WHERE status = 'FAILURE')::int AS failed,
               MAX("startedAt") AS last_run,
               AVG("durationMs") FILTER (WHERE status = 'SUCCESS')::float AS avg_ms,
               (ARRAY_AGG(error ORDER BY "startedAt" DESC) FILTER (WHERE error IS NOT NULL))[1] AS last_error
        FROM "ExternalSignalSyncRun"
        WHERE "startedAt" >= NOW() - MAKE_INTERVAL(days => ${WINDOW_DAYS})
        GROUP BY 1 ORDER BY 2 DESC`,
      prisma.$queryRaw<Array<{ h24: number; d7: number }>>`
        SELECT COUNT(*) FILTER (WHERE "occurredAt" >= NOW() - INTERVAL '24 hours')::int AS h24,
               COUNT(*) FILTER (WHERE "occurredAt" >= NOW() - MAKE_INTERVAL(days => ${WINDOW_DAYS}))::int AS d7
        FROM "ErrorEvent"`,
      prisma.$queryRaw<Array<{ source: string; n: number }>>`
        SELECT source, COUNT(*)::int AS n FROM "ErrorEvent"
        WHERE "occurredAt" >= NOW() - MAKE_INTERVAL(days => ${WINDOW_DAYS})
        GROUP BY 1 ORDER BY 2 DESC`,
      prisma.$queryRaw<Array<{ hits: number; misses: number }>>`
        SELECT COALESCE(SUM(hits), 0)::int AS hits, COALESCE(SUM(misses), 0)::int AS misses
        FROM "CacheStat"
        WHERE "hourBucket" >= NOW() - MAKE_INTERVAL(days => ${WINDOW_DAYS})`,
      prisma.$queryRaw<Array<{ mb: number; captured: Date }>>`
        SELECT ("totalBytes" / 1000000.0)::float AS mb, "capturedAt" AS captured
        FROM "DbSnapshot" ORDER BY "capturedAt" DESC LIMIT 2`,
      prisma.$queryRaw<Array<{ mb: number; objects: number }>>`
        SELECT ("totalBytes" / 1000000.0)::float AS mb, "objectCount"::int AS objects
        FROM "R2BucketSnapshot" ORDER BY "capturedAt" DESC LIMIT 1`,
      prisma.$queryRaw<Array<{ cost24: number; cost30: number; calls24: number }>>`
        SELECT COALESCE(SUM("estimatedCostUsd") FILTER (
                 WHERE "occurredAt" >= NOW() - INTERVAL '24 hours'), 0)::float AS cost24,
               COALESCE(SUM("estimatedCostUsd") FILTER (
                 WHERE "occurredAt" >= NOW() - INTERVAL '30 days'), 0)::float AS cost30,
               COUNT(*) FILTER (WHERE "occurredAt" >= NOW() - INTERVAL '24 hours')::int AS calls24
        FROM "AiUsageEvent"`,
      prisma.$queryRaw<
        Array<{ provider: string; status: string; rows: number; ms: number | null; at: Date }>
      >`
        SELECT provider, status::text AS status, "rowsWritten"::int AS rows,
               "durationMs"::int AS ms, "startedAt" AS at
        FROM "ExternalSignalSyncRun" ORDER BY "startedAt" DESC LIMIT 6`,
      prisma.$queryRaw<Array<{ source: string; message: string; at: Date }>>`
        SELECT source, message, "occurredAt" AS at
        FROM "ErrorEvent" ORDER BY "occurredAt" DESC LIMIT 6`,
    ])

  const dbMb = db[0]?.mb ?? null
  const dbGrowthMb =
    db.length === 2 && db[0] && db[1] ? db[0].mb - db[1].mb : null

  const recent = [
    ...recentRuns.map((r) => ({
      what: `${r.provider} sync ${r.status === "SUCCESS" ? "completed" : "failed"}`,
      detail:
        r.status === "SUCCESS"
          ? `${count(r.rows)} rows · ${((r.ms ?? 0) / 1000).toFixed(1)}s`
          : `${((r.ms ?? 0) / 1000).toFixed(1)}s`,
      at: r.at,
      ok: r.status === "SUCCESS",
    })),
    ...recentErrors.map((e) => ({
      what: e.source,
      detail: e.message.slice(0, 70),
      at: e.at,
      ok: false,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 8)

  return {
    providers: providers.map((p) => ({
      provider: p.provider,
      runs: p.runs,
      failed: p.failed,
      lastRun: p.last_run,
      avgMs: p.avg_ms,
      lastError: p.last_error,
    })),
    errors24h: errors[0]?.h24 ?? 0,
    errors7d: errors[0]?.d7 ?? 0,
    errorSources,
    cacheHits: cache[0]?.hits ?? 0,
    cacheMisses: cache[0]?.misses ?? 0,
    dbMb,
    dbGrowthMb,
    r2Mb: r2[0]?.mb ?? null,
    r2Objects: r2[0]?.objects ?? null,
    aiCost24h: ai[0]?.cost24 ?? 0,
    aiCost30d: ai[0]?.cost30 ?? 0,
    aiCalls24h: ai[0]?.calls24 ?? 0,
    recent,
  }
}

/* -- helpers ---------------------------------------------------------- */

const failPct = (p: Provider): number => (p.runs === 0 ? 0 : (p.failed / p.runs) * 100)
const isDead = (p: Provider): boolean => failPct(p) >= DEAD_PCT
const isFlaky = (p: Provider): boolean => p.failed > 0 && !isDead(p)

const ago = (d: Date | null): string => {
  if (d === null) return "never"
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

/** Megabytes back to bytes, so the shared `bytes()` is the only place a size is worded. */
const MB = (v: number | null): string => bytes(v === null ? null : v * 1e6)

/* -- sections --------------------------------------------------------- */

/**
 * The strip, and the two cells that were saying the wrong thing.
 *
 * `Syncs · Healthy` becomes the failure rate, because 21 of 21 PredictHQ runs
 * failed in the window and no reading of that is healthy. A DEAD provider is
 * counted apart from a FLAKY one: open-meteo failed 3 of 21 on SSL handshake
 * timeouts, which recovers on its own, and folding a 100% failure in with a
 * 14% one would report "two providers have failures" and hide which is which.
 *
 * `DB · 41 ms · p95 read` has no source — **nothing in this product records
 * query latency.** `DbSnapshot` records SIZE, which is a different question,
 * so the cell reports that and says which.
 */
function headlineOf(d: Data): MonitoringHeadline {
  const dead = d.providers.filter(isDead)
  const flaky = d.providers.filter(isFlaky)
  const hitRate =
    d.cacheHits + d.cacheMisses > 0
      ? (d.cacheHits / (d.cacheHits + d.cacheMisses)) * 100
      : null

  const syncCell: FigureProps = {
    label: "Syncs",
    value: dead.length > 0 ? `${count(dead.length)} down` : flaky.length > 0 ? "Flaky" : "Healthy",
    delta:
      dead.length > 0
        ? `${dead.map((p) => p.provider).join(", ")} — ${dead.map((p) => `${failPct(p).toFixed(0)}%`).join(", ")} failing`
        : flaky.length > 0
          ? `${flaky.map((p) => p.provider).join(", ")} intermittent`
          : `every provider clean over ${count(WINDOW_DAYS)} days`,
    deltaTone: dead.length > 0 ? "is-down" : "is-flat",
  }
  const errorCell: FigureProps = {
    label: `Errors, ${count(WINDOW_DAYS)}d`,
    value: count(d.errors7d),
    // What they ARE, not just how many. All five here are the cron watchdog,
    // and "5 errors" reads very differently from "the sync watchdog has been
    // shouting for a week".
    delta:
      d.errorSources.length === 0
        ? "none logged"
        : d.errorSources.every((s) => s.source.startsWith("cron."))
          ? "all of them the cron watchdog"
          : d.errorSources
              .slice(0, 2)
              .map((s) => s.source)
              .join(", "),
    deltaTone: d.errors7d > 0 ? "is-down" : "is-flat",
  }

  return {
    cells: [
      syncCell,
      {
        label: "Database",
        value: MB(d.dbMb),
        // NOT p95 read. Nothing records query latency anywhere in this product.
        delta:
          d.dbGrowthMb === null
            ? "size, not latency"
            : `${d.dbGrowthMb >= 0 ? "+" : "−"}${Math.abs(d.dbGrowthMb).toFixed(1)} MB since the last snapshot`,
        deltaTone: "is-flat",
      },
      {
        label: "Cache hit",
        value: hitRate === null ? "—" : pct(hitRate, { scaled: true }),
        delta: `${count(d.cacheHits)} hits · ${count(d.cacheMisses)} misses`,
        deltaTone: "is-flat",
      },
      errorCell,
    ],
    phoneCells: [syncCell, errorCell],
  }
}

/** The subsystems, one row each, every figure from a table that has rows. */
function subsystemsOf(d: Data): MonitoringSubsystems {
  const hitRate =
    d.cacheHits + d.cacheMisses > 0
      ? (d.cacheHits / (d.cacheHits + d.cacheMisses)) * 100
      : null

  // Built once as data, then rendered twice. The first draft mapped phoneRows
  // out of the finished `Row[]` and needed four casts to reach back into
  // `cells` — a shape meant for a table is the wrong source for a list.
  interface Sub {
    key: string
    system: string
    state: "OK" | "Flaky" | "Down"
    last: string
    duration: string
    volume: string
    note: string
  }

  const subs: Sub[] = [
    ...d.providers.map((p): Sub => ({
      key: p.provider,
      system: p.provider,
      state: isDead(p) ? "Down" : isFlaky(p) ? "Flaky" : "OK",
      last: ago(p.lastRun),
      duration: p.avgMs === null ? "—" : `${(p.avgMs / 1000).toFixed(1)}s`,
      volume: `${count(p.runs - p.failed)} of ${count(p.runs)} ran`,
      note: p.failed > 0 && p.lastError ? p.lastError.slice(0, 44) : "no failures",
    })),
    {
      key: "cache",
      system: "cache",
      state: "OK",
      last: "live",
      duration: "—",
      volume: hitRate === null ? "—" : pct(hitRate, { scaled: true }),
      note: `${count(d.cacheHits)} hits over ${count(WINDOW_DAYS)} days`,
    },
    {
      key: "db",
      system: "database",
      state: "OK",
      last: "daily snapshot",
      duration: "—",
      volume: MB(d.dbMb),
      note: "size only — no latency is recorded",
    },
    {
      key: "r2",
      system: "R2",
      state: "OK",
      last: "daily snapshot",
      duration: "—",
      volume: MB(d.r2Mb),
      note: d.r2Objects === null ? "—" : `${count(d.r2Objects)} objects`,
    },
    {
      key: "ai",
      system: "AI",
      state: "OK",
      last: "live",
      duration: "—",
      volume: money(d.aiCost30d, { cents: true }),
      note: `${count(d.aiCalls24h)} calls in 24h · ${money(d.aiCost24h, { cents: true })}`,
    },
  ]

  const rows: Row[] = subs.map((x) => ({
    key: x.key,
    cells: {
      system: x.system,
      state: x.state === "OK" ? x.state : { v: x.state, cls: "hot" },
      last: x.last,
      duration: x.duration,
      volume: x.volume,
      note: x.note,
    },
  }))

  const dead = d.providers.filter(isDead)

  return {
    rows,
    phoneRows: subs.slice(0, 5).map((x) => ({
      key: x.key,
      title: x.system,
      detail: x.note.slice(0, 40),
      value: x.volume,
      note: x.state,
      noteTone: x.state === "OK" ? ("up" as const) : ("down" as const),
    })),
    meta: `${count(rows.length)} subsystems · ${count(WINDOW_DAYS)} days`,
    note:
      dead.length === 0
        ? `Every provider ran clean over the window.`
        : `${dead.map((p) => p.provider).join(", ")} has failed ` +
          `${dead.map((p) => `${count(p.failed)} of ${count(p.runs)}`).join(", ")} runs — that is ` +
          `not flakiness, it is an integration that is down and still being called on a ` +
          `schedule, which is why it keeps producing rows that look like activity.`,
  }
}

/** Recent events — sync runs and errors, interleaved by time. */
function eventsOf(d: Data): MonitoringEvents {
  return {
    rows: d.recent.map((e, i) => ({
      key: `${e.at.toISOString()}:${i}`,
      title: e.what,
      detail: e.detail,
      value: ago(e.at),
      noteTone: e.ok ? "up" : "down",
    })),
    meta: `${count(d.recent.length)} most recent`,
    note:
      `Sync runs and errors on one timeline, because they are the same story told by two ` +
      `tables — the runs record what failed and the watchdog records that it noticed.`,
  }
}

/* -- assembly --------------------------------------------------------- */

export function getMonitoringSectionPromises(
  input: MonitoringInput,
): StreamedSections<MonitoringSections> {
  const dataP = classify(() => loadMonitoring(input), {
    retryAction: "retryMonitoring",
    isEmpty: () => false,
    emptyReason: "no_match",
  })

  const s = <T,>(f: (d: Data) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryMonitoring")

  return {
    headline: s(headlineOf),
    subsystems: s(subsystemsOf),
    events: s(eventsOf),
    tabs: Promise.resolve(ready(tabsOf())),
  }
}

export async function getMonitoringSections(
  input: MonitoringInput,
): Promise<MonitoringSections> {
  return awaitSections(getMonitoringSectionPromises(input))
}
