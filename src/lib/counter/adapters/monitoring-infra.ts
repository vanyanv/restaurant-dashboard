import { prisma } from "@/lib/prisma"
import { bytes, count } from "@/lib/counter/format"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, KvRow, Row } from "@/components/counter"

/**
 * Infrastructure — `P.moninfra` (`docs/counter/counter-prototype.html`).
 *
 * ## Every figure in the prototype's strip is about twenty times the truth
 *
 *   prototype                          measured
 *   Database 8.4 GB, +210 MB / 30d     306 MB, +9 MB / 30d
 *   R2 bucket 412 objects, 1.9 GB      298 objects, 88 MB
 *   Connections 12 / 100               not recorded anywhere
 *   Tokens — 1 expiring, GitHub 6d     no expiry data exists at all
 *
 * The Tokens panel is the honest casualty. Nothing in this database holds an
 * integration credential's expiry; the prototype's five rows — GitHub, Harri,
 * Otter, Graph Mail, Gemini, four of them tagged a green "OK" — are invented.
 * Five green tags derived from nothing is worse than no panel, because it
 * reads as a check that ran. The page says what it cannot tell you instead.
 *
 * ## Two of the four failing jobs are not failing
 *
 * `ml.operator-gate-check` shows 22 failures in 31 runs, far more than
 * anything else. Its metadata on a FAILURE run reads
 * `"overallPass": false, "gate3RevenueCoverageStrict": false` — the job ran
 * fine and exited non-zero to report that a gate did not pass. Counting it as
 * an outage inflates the failure total sevenfold and buries the one job that
 * genuinely breaks. This page separates "the job broke" from "the job
 * reported bad news", because a monitoring page that cannot tell those apart
 * trains you to ignore it.
 *
 * What is left is `otter.metrics.sync` at 18 failures in 524 runs (3.4%),
 * every one of them `Otter API error 500`, five of them inside four minutes
 * on 28 August. Upstream, clustered, not ours.
 *
 * See `docs/counter/measurements/2026-08-28-monitoring-ml-infra.md`.
 */

/** The window the jobs table reports over. */
const JOB_DAYS = 30
/** The window the error list reports over. */
const ERROR_DAYS = 7
/** How far back the growth figure looks. */
const GROWTH_DAYS = 30
/** Tables the storage section prints. */
const TABLE_ROWS = 10

/**
 * Jobs that exit non-zero to report a verdict rather than a fault. Their
 * "failures" are the product working, and are counted separately.
 */
const VERDICT_JOBS = new Set(["ml.operator-gate-check"])

interface TableRow {
  table: string
  bytes: number
  rows: number
}

interface JobRow {
  job: string
  runs: number
  failures: number
  meanMs: number | null
  lastAt: Date | null
  lastError: string | null
  verdictJob: boolean
}

interface ErrorRow {
  at: Date
  source: string
  message: string
}

interface PrefixRow {
  prefix: string
  bytes: number
  objects: number
}

interface InfraData {
  dbBytes: number | null
  dbBytesThen: number | null
  capturedAt: Date | null
  tables: TableRow[]
  r2Bytes: number | null
  r2Objects: number | null
  r2At: Date | null
  prefixes: PrefixRow[]
  jobs: JobRow[]
  errors: ErrorRow[]
}

/* ── Load ─────────────────────────────────────────────────────────────── */

/** `DbSnapshot.perTable` is written by the snapshot job as `{table,bytes,rows}[]`. */
function readPerTable(value: unknown): TableRow[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (entry === null || typeof entry !== "object") return null
      const row = entry as Record<string, unknown>
      const table = typeof row.table === "string" ? row.table : null
      const bytes = Number(row.bytes)
      if (table === null || !Number.isFinite(bytes)) return null
      return { table, bytes, rows: Number(row.rows) || 0 }
    })
    .filter((r): r is TableRow => r !== null)
    .sort((a, b) => b.bytes - a.bytes)
}

function readPrefixes(value: unknown): PrefixRow[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>)
    .map(([prefix, v]) => {
      if (v === null || typeof v !== "object") return null
      const row = v as Record<string, unknown>
      const bytes = Number(row.bytes)
      if (!Number.isFinite(bytes)) return null
      return { prefix, bytes, objects: Number(row.count) || 0 }
    })
    .filter((r): r is PrefixRow => r !== null)
    .sort((a, b) => b.bytes - a.bytes)
}

async function loadInfra(): Promise<InfraData> {
  const since = new Date(Date.now() - JOB_DAYS * 86_400_000)
  const growthSince = new Date(Date.now() - GROWTH_DAYS * 86_400_000)

  const [snap, older, r2, jobs, errors] = await Promise.all([
    prisma.dbSnapshot.findFirst({ orderBy: { date: "desc" } }),
    prisma.dbSnapshot.findFirst({
      where: { date: { lte: growthSince } },
      orderBy: { date: "desc" },
    }),
    prisma.r2BucketSnapshot.findFirst({ orderBy: { capturedAt: "desc" } }),
    prisma.$queryRaw<
      Array<{
        jobName: string
        runs: bigint
        failures: bigint
        meanMs: number | null
        lastAt: Date | null
        lastError: string | null
      }>
    >`
      SELECT "jobName",
             COUNT(*) runs,
             SUM(CASE WHEN status = 'FAILURE' THEN 1 ELSE 0 END) failures,
             AVG("durationMs") "meanMs",
             MAX("startedAt") "lastAt",
             (ARRAY_AGG("errorMessage" ORDER BY "startedAt" DESC)
                FILTER (WHERE "errorMessage" IS NOT NULL AND "errorMessage" <> ''))[1] "lastError"
      FROM "JobRun"
      WHERE "startedAt" > ${since}
      GROUP BY 1
      ORDER BY failures DESC, runs DESC`,
    prisma.errorEvent.findMany({
      where: { occurredAt: { gt: new Date(Date.now() - ERROR_DAYS * 86_400_000) } },
      orderBy: { occurredAt: "desc" },
      take: 8,
      select: { occurredAt: true, source: true, message: true },
    }),
  ])

  return {
    dbBytes: snap ? Number(snap.totalBytes) : null,
    dbBytesThen: older ? Number(older.totalBytes) : null,
    capturedAt: snap?.capturedAt ?? null,
    tables: snap ? readPerTable(snap.perTable).slice(0, TABLE_ROWS) : [],
    r2Bytes: r2 ? Number(r2.totalBytes) : null,
    r2Objects: r2?.objectCount ?? null,
    r2At: r2?.capturedAt ?? null,
    prefixes: r2 ? readPrefixes(r2.byPrefix) : [],
    jobs: jobs.map((j) => ({
      job: j.jobName,
      runs: Number(j.runs),
      failures: Number(j.failures),
      // AVG() comes back as a Decimal, which is not a finite number until coerced.
      meanMs: j.meanMs === null ? null : Number(j.meanMs),
      lastAt: j.lastAt,
      lastError: j.lastError,
      verdictJob: VERDICT_JOBS.has(j.jobName),
    })),
    errors: errors.map((e) => ({ at: e.occurredAt, source: e.source, message: e.message })),
  }
}

/* ── Shaping ──────────────────────────────────────────────────────────── */

function duration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function ago(at: Date | null): string {
  if (!at) return "never"
  const hours = Math.round((Date.now() - at.getTime()) / 3_600_000)
  if (hours < 1) return "just now"
  if (hours < 48) return `${count(hours)}h ago`
  return `${count(Math.round(hours / 24))}d ago`
}

export interface InfraHeadline {
  verdict: string
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

function headlineOf(d: InfraData): InfraHeadline {
  const real = d.jobs.filter((j) => !j.verdictJob)
  const realFailures = real.reduce((s, j) => s + j.failures, 0)
  const realRuns = real.reduce((s, j) => s + j.runs, 0)
  const verdictFailures = d.jobs.filter((j) => j.verdictJob).reduce((s, j) => s + j.failures, 0)
  const worst = real.filter((j) => j.failures > 0).sort((a, b) => b.failures - a.failures)[0]
  const growth = d.dbBytes !== null && d.dbBytesThen !== null ? d.dbBytes - d.dbBytesThen : null

  const verdict =
    `${count(realFailures)} of ${count(realRuns)} scheduled runs failed in ` +
    `${count(JOB_DAYS)} days` +
    (worst
      ? `, ${count(worst.failures)} of them ${worst.job}` +
        (worst.lastError ? ` returning "${worst.lastError.slice(0, 40)}"` : "")
      : "") +
    `. A further ${count(verdictFailures)} runs are recorded as failures and are not: ` +
    `ml.operator-gate-check exits non-zero to report that a model gate did not pass, ` +
    `which is the job working. Storage is ${bytes(d.dbBytes)} of database and ` +
    `${bytes(d.r2Bytes)} of files` +
    (growth !== null ? `, growing ${bytes(growth)} in ${count(GROWTH_DAYS)} days` : "") +
    `.`

  const cells: FigureProps[] = [
    {
      label: "Database",
      value: bytes(d.dbBytes),
      delta: growth === null ? undefined : `${bytes(growth)} in ${count(GROWTH_DAYS)}d`,
      deltaTone: "is-flat",
      caption: `snapshot ${ago(d.capturedAt)}`,
    },
    {
      label: "Files",
      value: bytes(d.r2Bytes),
      delta: `${count(d.r2Objects)} objects · ${ago(d.r2At)}`,
    },
    {
      label: "Runs that failed",
      value: `${count(realFailures)} of ${count(realRuns)}`,
      delta: `in ${count(JOB_DAYS)} days, gate verdicts excluded`,
      deltaTone: realFailures > 0 ? "is-down" : undefined,
    },
    {
      label: "Errors logged",
      value: count(d.errors.length),
      delta: `in ${count(ERROR_DAYS)} days, all of them the watchdog`,
      deltaTone: "is-flat",
    },
  ]

  return { verdict, cells, phoneCells: cells.slice(0, 2) }
}

export interface InfraStorage {
  rows: Row[]
  meta: string
  note: string
}

function storageOf(d: InfraData): InfraStorage {
  const total = d.dbBytes ?? d.tables.reduce((s, t) => s + t.bytes, 0)
  const shown = d.tables.reduce((s, t) => s + t.bytes, 0)

  return {
    rows: d.tables.map((t) => ({
      key: t.table,
      cells: {
        table: t.table,
        rows: count(t.rows),
        size: bytes(t.bytes),
        share: total > 0 ? `${((100 * t.bytes) / total).toFixed(1)}%` : "—",
      },
    })),
    meta: `${count(d.tables.length)} largest tables · snapshot ${ago(d.capturedAt)}`,
    note:
      `The snapshot job records only the largest tables, so these ` +
      `${bytes(shown)} are ${total > 0 ? ((100 * shown) / total).toFixed(0) : "—"}% of the ` +
      `${bytes(total)} total and the rest is spread across everything else. Order rows are the ` +
      `bulk of it; every forecast generation ever written is most of the remainder, which is ` +
      `the same reason a range summed without deduplicating on generatedAt reads 12x high.`,
  }
}

export interface InfraFiles {
  rows: KvRow[]
  meta: string
  note: string
}

function filesOf(d: InfraData): InfraFiles {
  return {
    rows: d.prefixes.map((p) => ({
      label: p.prefix,
      value: `${bytes(p.bytes)} · ${count(p.objects)} objects`,
    })),
    meta: `bucket snapshot ${ago(d.r2At)}`,
    note:
      `Invoice scans and product photographs. The prototype's strip reads 412 objects and ` +
      `1.9 GB; the bucket holds ${count(d.r2Objects)} objects and ${bytes(d.r2Bytes)}, which is ` +
      `about a twentieth of that.`,
  }
}

export interface InfraJobs {
  rows: Row[]
  meta: string
  note: string
}

function jobsOf(d: InfraData): InfraJobs {
  return {
    rows: d.jobs.map((j) => ({
      key: j.job,
      cells: {
        job: j.job,
        runs: count(j.runs),
        failures: j.verdictJob
          ? { v: `${count(j.failures)} verdicts`, cls: "hot" }
          : j.failures > 0
            ? { v: count(j.failures), cls: "hot" }
            : "none",
        mean: duration(j.meanMs),
        last: ago(j.lastAt),
        error: j.verdictJob
          ? "a gate did not pass"
          : j.lastError
            ? { v: j.lastError.slice(0, 40), cls: "hot" }
            : "—",
      },
    })),
    meta: `last ${count(JOB_DAYS)} days`,
    note:
      `ml.operator-gate-check's failures are verdicts, not faults: on a FAILURE run its ` +
      `metadata reads "overallPass": false with the gate that did not pass named beside it. ` +
      `The job ran, and exited non-zero to say so. Counting those as outages would put the ` +
      `failure total seven times higher than it is and hide otter.metrics.sync, which is the ` +
      `one job that genuinely breaks — always with an upstream 500, and in bursts rather than ` +
      `steadily.`,
  }
}

export interface InfraErrors {
  rows: Row[]
  meta: string
  note: string
}

function errorsOf(d: InfraData): InfraErrors {
  const sources = new Set(d.errors.map((e) => e.source))
  const allWatchdog = [...sources].every((s) => s.startsWith("cron."))

  return {
    rows: d.errors.map((e, i) => ({
      key: `${e.at.toISOString()}-${i}`,
      cells: {
        when: e.at.toISOString().slice(0, 16).replace("T", " "),
        source: e.source,
        message: e.message.slice(0, 90),
      },
    })),
    meta: `last ${count(ERROR_DAYS)} days`,
    note: allWatchdog
      ? `Every one of these is the cron watchdog reporting that a job is overdue, not an ` +
        `application error — there are none of those in the window. They are the same otter ` +
        `500 burst seen from the other side, which is why they arrive in clusters.`
      : `Sources beginning "cron." are the watchdog reporting overdue jobs rather than ` +
        `application errors.`,
  }
}

/**
 * What the prototype asks for and this product does not record. Stated rather
 * than rendered as five green tags derived from nothing.
 */
export interface InfraGaps {
  rows: KvRow[]
  note: string
}

function gapsOf(_d: InfraData): InfraGaps {
  return {
    rows: [
      { label: "Token expiry", value: "not recorded", tone: "warn" },
      { label: "Connection pool", value: "not recorded", tone: "warn" },
      { label: "Per-table growth", value: "top tables only", tone: "warn" },
    ],
    note:
      `The prototype's Tokens panel lists five integrations with expiry dates and a green ` +
      `"OK" against four of them. Nothing in this database holds a credential's expiry, so ` +
      `those tags would be decoration reading as a check that ran. Two credentials are known ` +
      `dead from their sync history rather than from any expiry field — the events feed on ` +
      `the model page is one — which is the honest way to find this out today.`,
  }
}

export interface InfraSections {
  headline: SectionData<InfraHeadline>
  jobs: SectionData<InfraJobs>
  errors: SectionData<InfraErrors>
  storage: SectionData<InfraStorage>
  files: SectionData<InfraFiles>
  gaps: SectionData<InfraGaps>
}

export function getInfraSectionPromises(): StreamedSections<InfraSections> {
  const dataP = classify(() => loadInfra(), {
    retryAction: "retryInfra",
    isEmpty: (d) => d.jobs.length === 0 && d.dbBytes === null,
    emptyReason: "no_match",
  })
  const s = <T,>(f: (d: InfraData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryInfra")
  return {
    headline: s(headlineOf),
    jobs: s(jobsOf),
    errors: s(errorsOf),
    storage: s(storageOf),
    files: s(filesOf),
    gaps: s(gapsOf),
  }
}

export async function getInfraSections(): Promise<InfraSections> {
  return awaitSections(getInfraSectionPromises())
}
