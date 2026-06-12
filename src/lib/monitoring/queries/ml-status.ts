// ML model health — busy-hours training/coverage/accuracy, the operator
// promotion gate, and external-signal (weather/events) freshness.

import { prisma } from "@/lib/prisma"

export type BusyHoursRunRow = {
  storeId: string
  startedAt: Date
  completedAt: Date | null
  status: "RUNNING" | "SUCCEEDED" | "FAILED"
  mape: number | null
  mae: number | null
  sampleSize: number | null
  modelVersion: string | null
  errorMessage: string | null
}

export type HarriCoverageRow = {
  storeId: string
  storeName: string
  daysWithLabor: number
  coveragePct: number
  lastSyncedAt: Date | null
  insufficient: boolean
}

export type StaleBusyHoursForecastRow = {
  storeId: string
  storeName: string
  latestGeneratedAt: Date | null
  latestForecastDate: Date | null
  forecastRows: number
  stale: boolean
}

export type BusyHoursAccuracy = {
  reconciledRows: number
  mape: number | null
  mae: number | null
}

export type BusyHoursModelStatus = {
  runs: BusyHoursRunRow[]
  harriCoverage: HarriCoverageRow[]
  staleForecasts: StaleBusyHoursForecastRow[]
  accuracy: BusyHoursAccuracy
}

export async function getBusyHoursModelStatus(): Promise<BusyHoursModelStatus> {
  const [runs, harriCoverage, staleForecasts, accuracyRows] = await Promise.all([
    prisma.$queryRaw<BusyHoursRunRow[]>`
      SELECT DISTINCT ON (scope)
        scope AS "storeId",
        "startedAt",
        "completedAt",
        status::text AS status,
        mape,
        mae,
        "sampleSize",
        "modelVersion",
        "errorMessage"
      FROM "MlTrainingRun"
      WHERE target = 'BUSY_HOURS'::"MlTarget"
        AND scope IS NOT NULL
      ORDER BY scope, "startedAt" DESC
    `,
    prisma.$queryRaw<HarriCoverageRow[]>`
      SELECT
        s.id AS "storeId",
        s.name AS "storeName",
        COUNT(hdl.date)::int AS "daysWithLabor",
        LEAST(1.0, COUNT(hdl.date)::float / 90.0) AS "coveragePct",
        MAX(hdl."syncedAt") AS "lastSyncedAt",
        (COUNT(hdl.date)::float / 90.0) < 0.6 AS insufficient
      FROM "Store" s
      LEFT JOIN "HarriDailyLabor" hdl
        ON hdl."storeId" = s.id
       AND hdl.date >= (CURRENT_DATE - 90)
       AND hdl.date < CURRENT_DATE
      WHERE s."isActive" = true
      GROUP BY s.id, s.name
      ORDER BY s.name ASC
    `,
    prisma.$queryRaw<StaleBusyHoursForecastRow[]>`
      SELECT
        s.id AS "storeId",
        s.name AS "storeName",
        MAX(fho."generatedAt") AS "latestGeneratedAt",
        MAX(fho."forecastDate") AS "latestForecastDate",
        COUNT(fho.id)::int AS "forecastRows",
        (
          MAX(fho."generatedAt") IS NULL
          OR MAX(fho."generatedAt") < (NOW() - INTERVAL '36 hours')
          OR COUNT(fho.id) < 24
        ) AS stale
      FROM "Store" s
      LEFT JOIN "ForecastHourlyOrders" fho
        ON fho."storeId" = s.id
       AND fho."forecastDate" >= CURRENT_DATE
       AND fho."forecastDate" < (CURRENT_DATE + 14)
      WHERE s."isActive" = true
      GROUP BY s.id, s.name
      ORDER BY s.name ASC
    `,
    prisma.$queryRaw<BusyHoursAccuracy[]>`
      SELECT
        COUNT(*)::int AS "reconciledRows",
        AVG(ABS("errorPct"))::float AS mape,
        AVG(ABS("actualOrders" - "predictedOrders"))::float AS mae
      FROM "ForecastHourlyOrders"
      WHERE "reconciledAt" IS NOT NULL
        AND "forecastDate" >= (CURRENT_DATE - 30)
    `,
  ])
  return {
    runs,
    harriCoverage,
    staleForecasts,
    accuracy: accuracyRows[0] ?? { reconciledRows: 0, mape: null, mae: null },
  }
}

export type OperatorGateRun = {
  startedAt: Date | null
  completedAt: Date | null
  status: "RUNNING" | "SUCCESS" | "FAILURE" | "PARTIAL" | null
  durationMs: number | null
  errorMessage: string | null
}

export type OperatorGateSignal = {
  key: "evalRows" | "seasonalNaive" | "coverage" | "reconciliation"
  label: string
  passed: boolean
  detail: string
}

export type OperatorGateStatus = {
  latestRun: OperatorGateRun | null
  passStreak: number
  neededPasses: number
  gates: OperatorGateSignal[]
}

type DailyGateRun = {
  day: Date
  status: "SUCCESS" | "FAILURE"
}

function isMissingRelationError(error: unknown): boolean {
  const err = error as { code?: string; message?: string; meta?: unknown }
  const detail = `${err.message ?? ""} ${JSON.stringify(err.meta ?? {})}`
  return err.code === "P2010" && (detail.includes("does not exist") || detail.includes("TableDoesNotExist"))
}

function countConsecutiveSuccesses(rows: DailyGateRun[]): number {
  let streak = 0
  for (const row of rows) {
    if (row.status !== "SUCCESS") break
    streak += 1
  }
  return streak
}

export async function getOperatorGateStatus(): Promise<OperatorGateStatus> {
  const [latestRun, dailyRuns] = await Promise.all([
    prisma.jobRun.findFirst({
      where: { jobName: "ml.operator-gate-check" },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, completedAt: true, status: true, durationMs: true, errorMessage: true },
    }),
    prisma.$queryRaw<DailyGateRun[]>`
      SELECT
        date_trunc('day', "startedAt") AS day,
        CASE
          WHEN BOOL_OR(status = 'SUCCESS'::"JobStatus") THEN 'SUCCESS'
          ELSE 'FAILURE'
        END AS status
      FROM "JobRun"
      WHERE "jobName" = 'ml.operator-gate-check'
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 14
    `,
  ])

  const fallback: OperatorGateStatus = {
    latestRun: latestRun
      ? {
          startedAt: latestRun.startedAt,
          completedAt: latestRun.completedAt,
          status: latestRun.status,
          durationMs: latestRun.durationMs,
          errorMessage: latestRun.errorMessage,
        }
      : null,
    passStreak: countConsecutiveSuccesses(dailyRuns),
    neededPasses: 7,
    gates: [
      {
        key: "evalRows",
        label: "Eval rows today",
        passed: false,
        detail: "MlForecastEvaluation table is not present in this database",
      },
      {
        key: "seasonalNaive",
        label: "Seasonal-naive gate",
        passed: false,
        detail: "Waiting for schema migration and the next nightly training run",
      },
      {
        key: "coverage",
        label: "Revenue interval coverage",
        passed: false,
        detail: "MlForecastEvaluation table is required for coverage checks",
      },
      {
        key: "reconciliation",
        label: "Reconciliation coverage",
        passed: false,
        detail: "Waiting for the operator gate check to run after schema is ready",
      },
    ],
  }

  const [schemaReady] = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT to_regclass('"MlForecastEvaluation"') IS NOT NULL AS "exists"
  `
  if (!schemaReady?.exists) return fallback

  let evalRows: { expected: number; covered: number }[]
  let seasonalRows: { naiveMentions: number; totalRuns: number }[]
  let coverageRows: {
    stores: number
    minCoverage: number | null
    avgCoverage: number | null
    maxCoverage: number | null
    outsideAcceptBand: number
  }[]
  let reconciliationRows: { tables: number; passingTables: number; minCoveragePct: number | null }[]

  try {
    [
      evalRows,
      seasonalRows,
      coverageRows,
      reconciliationRows,
    ] = await Promise.all([
    prisma.$queryRaw<{ expected: number; covered: number }[]>`
      WITH pairs AS (
        SELECT s.id AS "storeId", t.target
        FROM "Store" s
        CROSS JOIN (VALUES
          ('REVENUE'::"MlTarget"),
          ('BUSY_HOURS'::"MlTarget"),
          ('MENU_ITEM'::"MlTarget")
        ) AS t(target)
        WHERE s."isActive" = true
      )
      SELECT
        COUNT(*)::int AS expected,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM "MlForecastEvaluation" e
            WHERE e."storeId" = pairs."storeId"
              AND e.target = pairs.target
              AND e."computedAt"::date = CURRENT_DATE
          )
        )::int AS covered
      FROM pairs
    `,
    prisma.$queryRaw<{ naiveMentions: number; totalRuns: number }[]>`
      SELECT
        COUNT(*) FILTER (WHERE "errorMessage" ILIKE '%seasonal-naive%')::int AS "naiveMentions",
        COUNT(*)::int AS "totalRuns"
      FROM "MlTrainingRun"
      WHERE "startedAt" >= (CURRENT_DATE - INTERVAL '7 days')
    `,
    prisma.$queryRaw<{ stores: number; minCoverage: number | null; avgCoverage: number | null; maxCoverage: number | null; outsideAcceptBand: number }[]>`
      WITH per_store AS (
        SELECT
          s.id,
          AVG(e."intervalCoverage80")::float AS coverage
        FROM "Store" s
        JOIN "MlForecastEvaluation" e
          ON e."storeId" = s.id
         AND e.target = 'REVENUE'::"MlTarget"
         AND e."computedAt" >= (NOW() - INTERVAL '7 days')
         AND e."intervalCoverage80" IS NOT NULL
        WHERE s."isActive" = true
        GROUP BY s.id
      )
      SELECT
        COUNT(*)::int AS stores,
        MIN(coverage)::float AS "minCoverage",
        AVG(coverage)::float AS "avgCoverage",
        MAX(coverage)::float AS "maxCoverage",
        COUNT(*) FILTER (WHERE coverage < 0.75 OR coverage > 0.85)::int AS "outsideAcceptBand"
      FROM per_store
    `,
    prisma.$queryRaw<{ tables: number; passingTables: number; minCoveragePct: number | null }[]>`
      WITH coverage AS (
        SELECT 'ForecastDailyRevenue' AS table_name, COUNT(*)::int AS total, COUNT("actualRevenue")::int AS reconciled
        FROM "ForecastDailyRevenue"
        WHERE "forecastDate" < CURRENT_DATE
        UNION ALL
        SELECT 'ForecastHourlyOrders' AS table_name, COUNT(*)::int AS total, COUNT("actualOrders")::int AS reconciled
        FROM "ForecastHourlyOrders"
        WHERE "forecastDate" < CURRENT_DATE
        UNION ALL
        SELECT 'ForecastMenuItem' AS table_name, COUNT(*)::int AS total, COUNT("actualQty")::int AS reconciled
        FROM "ForecastMenuItem"
        WHERE "forecastDate" < CURRENT_DATE
      )
      SELECT
        COUNT(*)::int AS tables,
        COUNT(*) FILTER (
          WHERE total > 0 AND (reconciled::float / NULLIF(total, 0)) >= 0.8
        )::int AS "passingTables",
        MIN(CASE WHEN total > 0 THEN reconciled::float / total * 100 ELSE 0 END)::float AS "minCoveragePct"
      FROM coverage
    `,
    ])
  } catch (error) {
    if (isMissingRelationError(error)) return fallback
    throw error
  }

  const evalSummary = evalRows[0] ?? { expected: 0, covered: 0 }
  const seasonal = seasonalRows[0] ?? { naiveMentions: 0, totalRuns: 0 }
  const coverage = coverageRows[0] ?? {
    stores: 0,
    minCoverage: null,
    avgCoverage: null,
    maxCoverage: null,
    outsideAcceptBand: 0,
  }
  const reconciliation = reconciliationRows[0] ?? { tables: 0, passingTables: 0, minCoveragePct: null }

  const coverageDetail =
    coverage.stores > 0
      ? `${coverage.stores} stores, avg ${((coverage.avgCoverage ?? 0) * 100).toFixed(1)}%, range ${((coverage.minCoverage ?? 0) * 100).toFixed(1)}-${((coverage.maxCoverage ?? 0) * 100).toFixed(1)}%`
      : "No revenue coverage rows in the trailing 7 days"

  return {
    latestRun: latestRun
      ? {
          startedAt: latestRun.startedAt,
          completedAt: latestRun.completedAt,
          status: latestRun.status,
          durationMs: latestRun.durationMs,
          errorMessage: latestRun.errorMessage,
        }
      : null,
    passStreak: countConsecutiveSuccesses(dailyRuns),
    neededPasses: 7,
    gates: [
      {
        key: "evalRows",
        label: "Eval rows today",
        passed: evalSummary.expected > 0 && evalSummary.covered === evalSummary.expected,
        detail: `${evalSummary.covered}/${evalSummary.expected} active store-target pairs covered`,
      },
      {
        key: "seasonalNaive",
        label: "Seasonal-naive gate",
        passed: seasonal.naiveMentions > 0,
        detail: `${seasonal.naiveMentions}/${seasonal.totalRuns} runs mention seasonal-naive in 7 days`,
      },
      {
        key: "coverage",
        label: "Revenue interval coverage",
        passed: coverage.stores > 0 && coverage.outsideAcceptBand === 0,
        detail: coverageDetail,
      },
      {
        key: "reconciliation",
        label: "Reconciliation coverage",
        passed: reconciliation.tables === 3 && reconciliation.passingTables === 3,
        detail: `${reconciliation.passingTables}/${reconciliation.tables} tables >=80%, floor ${(reconciliation.minCoveragePct ?? 0).toFixed(1)}%`,
      },
    ],
  }
}

export type ExternalSignalCoverageSummary = {
  activeStores: number
  geocodedStores: number
  missingCoordinates: number
}

export type ExternalSignalFreshnessRow = {
  storeId: string
  storeName: string
  weatherSyncedAt: Date | null
  eventSyncedAt: Date | null
  weatherRows: number
  eventRows: number
  rawEventRows: number
  radiusMiles: number | null
  radiusProvider: string | null
  radiusUpdatedAt: Date | null
  staleWeather: boolean
  staleEvents: boolean
  earliestWeatherDate: Date | null
  latestWeatherDate: Date | null
  earliestEventDate: Date | null
  latestEventDate: Date | null
}

export type PromotedModelFlavorRow = {
  target: "REVENUE" | "BUSY_HOURS" | "MENU_ITEM" | "INVENTORY"
  modelVersion: string | null
  startedAt: Date
  mape: number | null
  mae: number | null
}

export type ExternalSignalStatus = {
  coverage: ExternalSignalCoverageSummary
  freshness: ExternalSignalFreshnessRow[]
  promotedModels: PromotedModelFlavorRow[]
}

export async function getExternalSignalStatus(): Promise<ExternalSignalStatus> {
  const [coverageRows, freshness, promotedModels] = await Promise.all([
    prisma.$queryRaw<ExternalSignalCoverageSummary[]>`
      SELECT
        COUNT(*)::int AS "activeStores",
        COUNT(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::int AS "geocodedStores",
        COUNT(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL)::int AS "missingCoordinates"
      FROM "Store"
      WHERE "isActive" = true
    `,
    prisma.$queryRaw<ExternalSignalFreshnessRow[]>`
      WITH weather AS (
        SELECT
          "storeId",
          MAX("syncedAt") AS "weatherSyncedAt",
          COUNT(*)::int AS "weatherRows",
          MIN(date) AS "earliestWeatherDate",
          MAX(date) AS "latestWeatherDate"
        FROM "StoreWeatherSignal"
        GROUP BY "storeId"
      ),
      events AS (
        SELECT
          "storeId",
          MAX("syncedAt") AS "eventSyncedAt",
          COUNT(*)::int AS "eventRows",
          MIN(date) AS "earliestEventDate",
          MAX(date) AS "latestEventDate"
        FROM "StoreEventSignal"
        GROUP BY "storeId"
      ),
      event_details AS (
        SELECT
          "storeId",
          COUNT(*)::int AS "rawEventRows"
        FROM "StoreEventDetailSignal"
        GROUP BY "storeId"
      )
      SELECT
        s.id AS "storeId",
        s.name AS "storeName",
        w."weatherSyncedAt",
        e."eventSyncedAt",
        COALESCE(w."weatherRows", 0)::int AS "weatherRows",
        COALESCE(e."eventRows", 0)::int AS "eventRows",
        COALESCE(ed."rawEventRows", 0)::int AS "rawEventRows",
        s."eventSignalRadiusMiles"::float AS "radiusMiles",
        s."eventSignalRadiusProvider" AS "radiusProvider",
        s."eventSignalRadiusUpdatedAt" AS "radiusUpdatedAt",
        (w."weatherSyncedAt" IS NULL OR w."weatherSyncedAt" < (NOW() - INTERVAL '36 hours')) AS "staleWeather",
        (e."eventSyncedAt" IS NULL OR e."eventSyncedAt" < (NOW() - INTERVAL '36 hours')) AS "staleEvents",
        w."earliestWeatherDate",
        w."latestWeatherDate",
        e."earliestEventDate",
        e."latestEventDate"
      FROM "Store" s
      LEFT JOIN weather w ON w."storeId" = s.id
      LEFT JOIN events e ON e."storeId" = s.id
      LEFT JOIN event_details ed ON ed."storeId" = s.id
      WHERE s."isActive" = true
      ORDER BY s.name ASC
    `,
    prisma.$queryRaw<PromotedModelFlavorRow[]>`
      SELECT DISTINCT ON (target)
        target::text AS target,
        "modelVersion",
        "startedAt",
        mape,
        mae
      FROM "MlTrainingRun"
      WHERE target IN ('REVENUE'::"MlTarget", 'BUSY_HOURS'::"MlTarget")
        AND status = 'SUCCEEDED'::"MlTrainingStatus"
      ORDER BY target, "startedAt" DESC
    `,
  ])
  return {
    coverage: coverageRows[0] ?? { activeStores: 0, geocodedStores: 0, missingCoordinates: 0 },
    freshness,
    promotedModels,
  }
}
