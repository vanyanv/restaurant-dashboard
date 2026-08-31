import { prisma } from "@/lib/prisma"
import { count, money, pct } from "@/lib/counter/format"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, MListRow, QueueItem, Row } from "@/components/counter"

/**
 * Model health — `P.monml` (`docs/counter/counter-prototype.html`).
 *
 * ## The prototype's headline is the opposite of what the pipeline does
 *
 * `P.monml`'s strip claims **"Beat the naive guess — 21 of 30, by $186 a
 * day."** Measured across every `MlForecastEvaluation` row carrying both a
 * model WAPE and the seasonal-naive `y[t-7]` baseline fit on the same rows:
 *
 *   REVENUE      187 evaluations    0 beat the baseline   11.15% vs  7.11%
 *   MENU_ITEM     89 evaluations   64 beat the baseline   40.33% vs 52.80%
 *   BUSY_HOURS    89 evaluations   77 beat the baseline   37.83% vs 74.08%
 *
 * **The revenue model has never beaten "the same day last week."** Not once,
 * in 187 evaluations, and it is a third worse on average. The same pipeline
 * halves the baseline's error on busy hours. So the finding is narrow and
 * worth stating precisely: the flagship number is the one target the model
 * does not win, and the page leads with that rather than with an accuracy
 * figure that reads fine in isolation.
 *
 * ## Gate 2 cannot catch it, by construction
 *
 * `gate2_seasonal_naive_fired` passes 28 of 28 days. Its detail reads
 * `REVENUE 6/9 runs mention seasonal-naive`. It checks the baseline was
 * *computed*, not that the model *beat* it — so it passes every day for a
 * month while the thing it is named after loses every time. The page prints
 * the gate's verdict and the comparison next to each other.
 *
 * ## MAPE is not shown for menu items
 *
 * `MlTrainingRun` records `mape = 80844.6` for MENU_ITEM with status
 * SUCCEEDED — 8.08 million percent. MAPE divides by actuals and per-item
 * daily quantities are frequently 1 or 0, so the number is arithmetic noise.
 * WAPE weights by volume and survives; it is the only error figure this page
 * prints.
 *
 * ## A month-old version string is not a stuck pipeline
 *
 * The newest MENU_ITEM evaluation grades a model trained 29 July. That is
 * correct: yesterday's model has 0 of its 210 forecast rows reconciled,
 * because the days it forecasts have not happened. Reconciliation accrues
 * down the generations (22 rows at one day old, 140 at five). The page says
 * so, so the date does not read as a fault.
 *
 * See `docs/counter/measurements/2026-08-28-monitoring-ml-infra.md`.
 */

/** The window the gate table reports over. */
const GATE_DAYS = 30
/** Rows the phone lists print — `P.monml.phone()` shows three gates. */
const PHONE_ROWS = 3
/** A feed that has not written a row in this long is dead, not slow. */
const SIGNAL_DEAD_MS = 7 * 86_400_000
/** Days of forecast-against-actual the chart draws. */
const CHART_DAYS = 21
/** Rows the runs table prints. */
const RUN_ROWS = 8

type Target = "REVENUE" | "MENU_ITEM" | "BUSY_HOURS"

/** What each target is a forecast OF, in words an operator would use. */
const TARGET_LABEL: Record<Target, string> = {
  REVENUE: "Daily revenue",
  MENU_ITEM: "Menu item quantity",
  BUSY_HOURS: "Orders by hour",
}

interface TargetRow {
  target: Target
  evaluations: number
  wins: number
  wape: number | null
  baseline: number | null
  coverage: number | null
  newestVersion: string | null
  newestWape: number | null
  newestBaseline: number | null
  newestCoverage: number | null
  sampleSize: number
  windowEnd: Date | null
}

interface GateRow {
  gate: string
  days: number
  passed: number
  lastPassed: boolean | null
  lastDetail: string | null
}

interface RunRow {
  startedAt: Date
  target: Target
  version: string | null
  status: string
  sampleSize: number | null
}

interface DayRow {
  date: string
  forecast: number
  actual: number | null
}

interface SignalRow {
  provider: string
  runs: number
  failures: number
  rowsWritten: number
  lastAt: Date | null
  lastOkAt: Date | null
  lastError: string | null
}

interface MlData {
  targets: TargetRow[]
  signals: SignalRow[]
  gates: GateRow[]
  runs: RunRow[]
  days: DayRow[]
  /** Newest forecast generation still ahead of today, for the "next" figure. */
  pendingDays: number
  lastRunAt: Date | null
}

/* ── Load ─────────────────────────────────────────────────────────────── */

async function loadMl(): Promise<MlData> {
  const [agg, newest, gates, gateLast, runs, days, pending, lastRun, signals] = await Promise.all([
    prisma.$queryRaw<
      Array<{ target: string; n: bigint; wins: bigint; wape: number | null; base: number | null; cov: number | null }>
    >`
      SELECT target,
             COUNT(*) n,
             SUM(CASE WHEN wape < "baselineWape" THEN 1 ELSE 0 END) wins,
             AVG(wape) wape, AVG("baselineWape") base, AVG("intervalCoverage80") cov
      FROM "MlForecastEvaluation"
      WHERE wape IS NOT NULL AND "baselineWape" IS NOT NULL
      GROUP BY 1`,
    prisma.$queryRaw<
      Array<{
        target: string
        modelVersion: string
        wape: number | null
        baselineWape: number | null
        intervalCoverage80: number | null
        sampleSize: number
        windowEnd: Date
      }>
    >`
      SELECT DISTINCT ON (target)
             target, "modelVersion", wape, "baselineWape", "intervalCoverage80", "sampleSize", "windowEnd"
      FROM "MlForecastEvaluation"
      ORDER BY target, "computedAt" DESC`,
    prisma.$queryRaw<Array<{ gateName: string; n: bigint; passed: bigint }>>`
      SELECT "gateName", COUNT(*) n, SUM(CASE WHEN passed THEN 1 ELSE 0 END) passed
      FROM "OperatorGateDailyVerdict"
      WHERE "verdictDate" > CURRENT_DATE - ${GATE_DAYS}::int
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<Array<{ gateName: string; passed: boolean; detail: string | null }>>`
      SELECT DISTINCT ON ("gateName") "gateName", passed, detail
      FROM "OperatorGateDailyVerdict"
      ORDER BY "gateName", "verdictDate" DESC`,
    prisma.mlTrainingRun.findMany({
      orderBy: { startedAt: "desc" },
      take: RUN_ROWS,
      select: { startedAt: true, target: true, modelVersion: true, status: true, sampleSize: true },
    }),
    prisma.$queryRaw<Array<{ d: Date; forecast: number; actual: number | null }>>`
      WITH f AS (
        SELECT DISTINCT ON ("forecastDate") "forecastDate" d, "predictedRevenue" forecast
        FROM "ForecastDailyRevenue"
        -- CURRENT_DATE is UTC; at 8pm Pacific that is already tomorrow, which
        -- would let today's half-synced sales in as a 60% undershoot.
        WHERE "hourBucket" = 0
          AND "forecastDate" < (NOW() AT TIME ZONE 'America/Los_Angeles')::date
        ORDER BY "forecastDate" DESC, "generatedAt" DESC
      ),
      a AS (
        SELECT date, SUM(COALESCE("fpNetSales", 0) + COALESCE("tpNetSales", 0)) net
        FROM "OtterDailySummary" GROUP BY 1
      )
      SELECT f.d, f.forecast, a.net actual
      FROM f LEFT JOIN a ON a.date = f.d
      ORDER BY f.d DESC LIMIT ${CHART_DAYS}::int`,
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(DISTINCT "forecastDate") n
      FROM "ForecastDailyRevenue"
      WHERE "hourBucket" = 0
        AND "forecastDate" >= (NOW() AT TIME ZONE 'America/Los_Angeles')::date`,
    prisma.mlTrainingRun.findFirst({
      where: { status: "SUCCEEDED" },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    }),
    prisma.$queryRaw<
      Array<{
        provider: string
        runs: bigint
        failures: bigint
        rowsWritten: bigint | null
        lastAt: Date | null
        lastOkAt: Date | null
        lastError: string | null
      }>
    >`
      SELECT provider,
             COUNT(*) runs,
             SUM(CASE WHEN status <> 'SUCCESS' THEN 1 ELSE 0 END) failures,
             SUM("rowsWritten") "rowsWritten",
             MAX("startedAt") "lastAt",
             MAX("startedAt") FILTER (WHERE status = 'SUCCESS') "lastOkAt",
             (ARRAY_AGG(error ORDER BY "startedAt" DESC) FILTER (WHERE error IS NOT NULL))[1] "lastError"
      FROM "ExternalSignalSyncRun"
      GROUP BY 1 ORDER BY 1`,
  ])

  const byTarget = new Map(agg.map((r) => [r.target, r]))
  const byNewest = new Map(newest.map((r) => [r.target, r]))
  const lastByGate = new Map(gateLast.map((r) => [r.gateName, r]))

  const targets: TargetRow[] = (Object.keys(TARGET_LABEL) as Target[]).map((target) => {
    const a = byTarget.get(target)
    const n = byNewest.get(target)
    return {
      target,
      evaluations: a ? Number(a.n) : 0,
      wins: a ? Number(a.wins) : 0,
      wape: a?.wape ?? null,
      baseline: a?.base ?? null,
      coverage: a?.cov ?? null,
      newestVersion: n?.modelVersion ?? null,
      newestWape: n?.wape ?? null,
      newestBaseline: n?.baselineWape ?? null,
      newestCoverage: n?.intervalCoverage80 ?? null,
      sampleSize: n?.sampleSize ?? 0,
      windowEnd: n?.windowEnd ?? null,
    }
  })

  return {
    targets,
    signals: signals.map((r) => ({
      provider: r.provider,
      runs: Number(r.runs),
      failures: Number(r.failures),
      rowsWritten: Number(r.rowsWritten ?? 0),
      lastAt: r.lastAt,
      lastOkAt: r.lastOkAt,
      lastError: r.lastError,
    })),
    gates: gates.map((g) => {
      const last = lastByGate.get(g.gateName)
      return {
        gate: g.gateName,
        days: Number(g.n),
        passed: Number(g.passed),
        lastPassed: last?.passed ?? null,
        lastDetail: last?.detail ?? null,
      }
    }),
    runs: runs.map((r) => ({
      startedAt: r.startedAt,
      target: r.target as Target,
      version: r.modelVersion,
      status: r.status,
      sampleSize: r.sampleSize,
    })),
    days: days
      .map((d) => ({
        date: d.d.toISOString().slice(0, 10),
        forecast: Number(d.forecast),
        actual: d.actual === null ? null : Number(d.actual),
      }))
      .reverse(),
    pendingDays: Number(pending[0]?.n ?? 0),
    lastRunAt: lastRun?.startedAt ?? null,
  }
}

/* ── Shaping ──────────────────────────────────────────────────────────── */

/** The gate names are snake_case with a leading index; the page wants words. */
function gateLabel(gate: string): string {
  const stripped = gate.replace(/^gate(\d+)_/, "$1 · ").replace(/_/g, " ")
  return stripped.charAt(0).toUpperCase() + stripped.slice(1)
}

/** A version string is `xgboost-<sha>-<stamp>-<variant>`; the date is what reads. */
function versionDate(version: string | null): string {
  if (!version) return "—"
  // Greedy prefix: the sha is also eight digits, so anchor on the LAST stamp.
  const m = version.match(/.*-(\d{8})-\d{4}/)
  if (!m) return version
  return `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`
}

function ago(at: Date | null): string {
  if (!at) return "—"
  const hours = Math.round((Date.now() - at.getTime()) / 3_600_000)
  if (hours < 1) return "just now"
  if (hours < 48) return `${count(hours)}h ago`
  return `${count(Math.round(hours / 24))}d ago`
}

export interface MlHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

function headlineOf(d: MlData): MlHeadline {
  const revenue = d.targets.find((t) => t.target === "REVENUE")
  const wins = d.targets.reduce((s, t) => s + t.wins, 0)
  const evals = d.targets.reduce((s, t) => s + t.evaluations, 0)
  const gate3 = d.gates.find((g) => g.gate.startsWith("gate3"))

  const cells: FigureProps[] = [
    {
      // No `caption`: it opens a `.band`, and `P.monml`'s own strip cells are
      // four-tuples. The words it held ("times the model won") only repeated
      // the label.
      label: "Revenue vs last week",
      value: `${count(revenue?.wins ?? 0)} of ${count(revenue?.evaluations ?? 0)}`,
      deltaTone: "is-down",
      delta: revenue ? `${pct(revenue.wape)} vs ${pct(revenue.baseline)} baseline` : undefined,
    },
    {
      label: "Busy hours vs last week",
      value: `${count(d.targets.find((t) => t.target === "BUSY_HOURS")?.wins ?? 0)} of ${count(
        d.targets.find((t) => t.target === "BUSY_HOURS")?.evaluations ?? 0,
      )}`,
      delta: "the same pipeline, a harder target",
    },
    {
      label: "Interval coverage gate",
      value: gate3 ? `${count(gate3.passed)} of ${count(gate3.days)}` : "—",
      delta: `days passed in ${count(GATE_DAYS)}`,
      deltaTone: gate3 && gate3.passed < gate3.days / 2 ? "is-down" : undefined,
    },
    {
      label: "Last trained",
      value: ago(d.lastRunAt),
      delta: `${count(d.pendingDays)} days forecast ahead`,
      deltaTone: "is-flat",
    },
  ]

  return { cells, phoneCells: cells.slice(0, 2) }
}

export interface MlAccuracy {
  chart: ChartSpec
  meta: string
  note: string
}

function accuracyOf(d: MlData): MlAccuracy {
  const graded = d.days.filter((x) => x.actual !== null)
  const misses = graded.map((x) => Math.abs(x.forecast - (x.actual ?? 0)))
  const meanMiss = misses.length ? misses.reduce((a, b) => a + b, 0) / misses.length : null

  return {
    chart: {
      type: "line",
      h: 158,
      labels: d.days.map((x) => x.date.slice(5)),
      legend: true,
      vs: 0,
      alt: "Forecast revenue against actual net sales, by day",
      series: [
        { name: "Actual", data: d.days.map((x) => x.actual), color: "var(--ct-ink)", fill: true },
        { name: "Forecast", data: d.days.map((x) => x.forecast), color: "var(--ct-accent)", dash: true, w: 1.5 },
      ],
    },
    meta: `${count(graded.length)} graded days · newest generation per date`,
    note:
      `Each day takes the most recent forecast written for it, not the one written furthest ` +
      `ahead. Today is excluded — a half-synced day reads as a 150% overshoot and means ` +
      `nothing. Across the ${count(graded.length)} graded days the average miss is ` +
      `${meanMiss === null ? "—" : money(meanMiss)}.`,
  }
}

export interface MlGates {
  rows: Row[]
  phoneRows: MListRow[]
  meta: string
  note: string
}

function gatesOf(d: MlData): MlGates {
  const rows: Row[] = d.gates.map((g) => ({
    key: g.gate,
    cells: {
      gate: gateLabel(g.gate),
      passed: {
        v: `${count(g.passed)} of ${count(g.days)}`,
        cls: g.passed === g.days ? undefined : "hot",
      },
      last:
        g.lastPassed === null
          ? "—"
          : g.lastPassed
            ? "Passed"
            : { v: "Failed", cls: "hot" },
      detail: (g.lastDetail ?? "").split("\n")[0]?.trim().replace(/^\s+/, "") || "—",
    },
  }))

  const gate2 = d.gates.find((g) => g.gate.startsWith("gate2"))
  const revenue = d.targets.find((t) => t.target === "REVENUE")

  return {
    rows,
    // `P.monml.phone()` lists three gates, the ones with something to say.
    // Sorted by how often they fail, so a gate that has never passed cannot be
    // pushed off the phone by one that always does.
    phoneRows: [...d.gates]
      .sort((a, b) => a.passed / (a.days || 1) - b.passed / (b.days || 1))
      .slice(0, PHONE_ROWS)
      .map((g) => ({
        key: g.gate,
        title: gateLabel(g.gate),
        detail: `${count(g.passed)} of ${count(g.days)} days`,
        value: g.lastPassed === null ? "—" : g.lastPassed ? "Pass" : "Fail",
        note: "",
        noteTone: (g.lastPassed ? "up" : "down") as "up" | "down",
      })),
    meta: `last ${count(GATE_DAYS)} days · detail from the newest verdict`,
    note:
      gate2 && revenue
        ? `Gate 2 is named for the seasonal-naive baseline and has passed ${count(gate2.passed)} ` +
          `of ${count(gate2.days)} days. It checks the baseline was COMPUTED, not that the model ` +
          `beat it — which is why it can pass every day for a month while the revenue model loses ` +
          `${count(revenue.evaluations - revenue.wins)} of ${count(revenue.evaluations)} ` +
          `comparisons. Gate 3 is a band rather than a floor: it failed at 0.886 coverage on ` +
          `26 August, because an 80% interval that contains 88.6% of actuals is too wide.`
        : `Gate detail comes from the newest verdict for each gate.`,
  }
}

/**
 * `P.monml`'s "Known gaps" — the queue, and where three tables went.
 *
 * The prototype lists two: the event signals are dead, and two stores are
 * pre-open. Ours are DERIVED, not written down, so the list is whatever is
 * actually wrong tonight:
 *
 *   1. Any external feed that has not written a row in a week. `predicthq`
 *      qualifies — 401 unauthorized on every run since 10 August — which is
 *      the prototype's own first item, arrived at from the sync history rather
 *      than from a note.
 *   2. Any forecast target the model loses to its own seasonal-naive baseline.
 *      Revenue qualifies and nothing else does: 0 wins in 232 evaluations at
 *      10.5% error against the baseline's 6.8%, while menu items and orders by
 *      hour both win comfortably. That is the biggest single fact on this page
 *      and it had been sitting in a verdict paragraph the design has no room
 *      for.
 *
 * This is what replaced "Against the baseline", "External signals" and
 * "Training runs" — three tables where `P.monml` has one, and it is not a
 * table at all. A queue item is a problem with a size and a sentence; a table
 * is a thing you scan. Both dead feeds and both winning targets are still
 * measured, they are just not each given a table of their own.
 */
/** What each provider feeds the model, in words rather than a table name. */
const PROVIDER_LABEL: Record<string, string> = {
  "open-meteo": "Weather",
  predicthq: "Local events",
}

export interface MlGaps {
  items: QueueItem[]
  meta: string
}

function gapsOf(d: MlData): MlGaps {
  const items: QueueItem[] = []

  const dead = d.signals.filter(
    (x) => x.lastOkAt !== null && Date.now() - x.lastOkAt.getTime() > SIGNAL_DEAD_MS,
  )
  for (const x of dead) {
    const days = Math.round((Date.now() - (x.lastOkAt?.getTime() ?? 0)) / 86_400_000)
    items.push({
      key: `signal-${x.provider}`,
      tone: "warn",
      lead: count(days),
      unit: "days dark",
      title: `${PROVIDER_LABEL[x.provider] ?? x.provider} stopped writing`,
      body:
        `Last row on ${x.lastOkAt?.toISOString().slice(0, 10)}; every run since has failed, ` +
        `${count(x.failures)} in total, newest "${(x.lastError ?? "").slice(0, 44)}". The model ` +
        `still trains — the feature is simply absent from every forecast made since, which is ` +
        `what a gate means when its detail reads "events absent".`,
    })
  }

  for (const t of d.targets) {
    if (t.evaluations === 0 || t.wins > 0) continue
    items.push({
      key: `baseline-${t.target}`,
      tone: "bad",
      lead: count(t.wins),
      unit: `of ${count(t.evaluations)}`,
      title: `${TARGET_LABEL[t.target]} loses to the naive baseline`,
      body:
        `${pct(t.wape)} error against the baseline's ${pct(t.baseline)} — worse than ` +
        `forecasting the same weekday last week, which is one line of code. The gate named for ` +
        `the baseline checks that it was COMPUTED, not that the model beat it, so this can run ` +
        `green for a month. The harder targets are a different story and win.`,
    })
  }

  return { items, meta: count(items.length) }
}

export interface MlSections {
  headline: SectionData<MlHeadline>
  accuracy: SectionData<MlAccuracy>
  gates: SectionData<MlGates>
  gaps: SectionData<MlGaps>
}

export function getMlSectionPromises(): StreamedSections<MlSections> {
  const dataP = classify(() => loadMl(), {
    retryAction: "retryMl",
    isEmpty: (d) => d.targets.every((t) => t.evaluations === 0) && d.runs.length === 0,
    emptyReason: "no_match",
  })
  const s = <T,>(f: (d: MlData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryMl")
  return {
    headline: s(headlineOf),
    accuracy: s(accuracyOf),
    gates: s(gatesOf),
    gaps: s(gapsOf),
  }
}

export async function getMlSections(): Promise<MlSections> {
  return awaitSections(getMlSectionPromises())
}
