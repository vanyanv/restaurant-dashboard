/**
 * Harri (LiveWire) labor sync runner.
 *
 * Pulls per-day labor totals, per-position breakdown, and clock-in/out
 * timekeeping alerts from Harri's gateway and upserts into:
 *   - HarriDailyLabor (one row per storeId+date)
 *   - HarriPositionDaily (one row per storeId+date+category+position+payType)
 *   - HarriTimekeepingAlert (one row per Harri alert id)
 *
 * All cost values are converted from Harri's native cents to USD before
 * persistence. See docs/harri-api-notes.md for endpoint shapes.
 */

import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { withJobRun } from "@/lib/monitoring/job-run"
import { isoWeekStartsCovering } from "@/lib/labor-week"
import {
  buildDeleteMissingSql,
  dedupeByKey,
  planChangedUpserts,
  upsertChangedRows,
  type ChangedUpsertSpec,
  type UpsertRow,
} from "@/lib/upsert-changed"
import {
  buildLaborActualUrl,
  buildLaborCategoriesUrl,
  buildLaborForecastUrl,
  buildPositionsPayTypesUrl,
  buildTimekeepingAlertsUrl,
  harriCentsToUSD,
  harriDateRange,
  harriFetch,
  type HarriAlert,
  type HarriAlertsResponse,
  type HarriDayBreakdown,
  type HarriEnvelope,
  type HarriLaborCategoriesResponse,
  type HarriLaborTotal,
  type HarriPositionsPayTypesResponse,
} from "@/lib/harri"

export type HarriSyncTrigger = "cron" | "manual" | "webhook" | "github-actions" | "internal"

export type RunHarriLaborSyncOpts = {
  storeId: string
  startDate: Date
  endDate: Date
  triggeredBy: HarriSyncTrigger
}

export type HarriSyncResult = {
  daysWritten: number
  positionsWritten: number
  alertsWritten: number
  /**
   * Rows actually inserted or updated across the three tables. The counts
   * above are rows sent; an unchanged row is no longer rewritten, and its
   * `syncedAt` only moves when the row changes.
   */
  rowsChanged: number
}

/** @@unique([storeId, date]) */
export const HARRI_DAILY_LABOR_UPSERT: ChangedUpsertSpec = {
  table: "HarriDailyLabor",
  conflict: [
    { name: "storeId", type: "text" },
    { name: "date", type: "date" },
  ],
  values: [
    { name: "actualCost", type: "float" },
    { name: "forecastCost", type: "float" },
    { name: "categories", type: "jsonb" },
  ],
  touch: "syncedAt",
}

/** @@unique([storeId, date, categoryCode, positionCode, payType]) */
export const HARRI_POSITION_DAILY_UPSERT: ChangedUpsertSpec = {
  table: "HarriPositionDaily",
  conflict: [
    { name: "storeId", type: "text" },
    { name: "date", type: "date" },
    { name: "categoryCode", type: "text" },
    { name: "positionCode", type: "text" },
    { name: "payType", type: "text" },
  ],
  values: [
    { name: "categoryName", type: "text" },
    { name: "positionName", type: "text" },
    { name: "totalLabor", type: "float" },
    { name: "netAmount", type: "float" },
    { name: "overtimeAmount", type: "float" },
    { name: "bonusAmount", type: "float" },
    { name: "totalShiftCount", type: "int" },
    { name: "actualSeconds", type: "int" },
    { name: "userIds", type: "int[]" },
    { name: "rawCost", type: "jsonb" },
  ],
  touch: "syncedAt",
}

/**
 * harriAlertId @unique. The update only ever refreshed the alert's timing
 * fields; who/where (store, date, employee, position) are set on insert only,
 * exactly as the per-row upsert did.
 */
export const HARRI_ALERT_UPSERT: ChangedUpsertSpec = {
  table: "HarriTimekeepingAlert",
  conflict: [{ name: "harriAlertId", type: "bigint" }],
  insertOnly: [
    { name: "storeId", type: "text" },
    { name: "date", type: "date" },
    { name: "employeeId", type: "int" },
    { name: "userId", type: "int" },
    { name: "positionId", type: "int" },
    { name: "positionCode", type: "text" },
    { name: "positionName", type: "text" },
    { name: "categoryCode", type: "text" },
  ],
  values: [
    { name: "alertTime", type: "timestamp" },
    { name: "alertCode", type: "text" },
    { name: "alertTypeId", type: "int" },
    { name: "timeDiffSec", type: "int" },
    { name: "missedClockAt", type: "timestamp" },
  ],
  touch: "syncedAt",
}

/** "Harri API error 500 on /path" — the message without the response body. */
function errorHead(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason)
  return message.match(/^Harri API error \d+ on \S+/)?.[0] ?? message.slice(0, 300)
}

/** Harri answered with an HTTP error, as opposed to a timeout or network failure. */
function isHarriHttpError(reason: unknown): boolean {
  return reason instanceof Error && /^Harri API error \d+ on /.test(reason.message)
}

export async function runHarriLaborSync(opts: RunHarriLaborSyncOpts): Promise<HarriSyncResult> {
  const { storeId, startDate, endDate, triggeredBy } = opts

  return withJobRun(
    "harri-labor-sync",
    {
      storeId,
      triggeredBy,
      metadata: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    },
    async ({ addRows, jobRunId }) => {
      const brand = await prisma.harriBrand.findFirst({
        where: { storeId, active: true },
      })
      if (!brand) {
        throw new Error(
          `No active HarriBrand mapping for storeId=${storeId}. Configure via the store dossier (one HarriBrand row per Harri operations brand_id).`
        )
      }

      const brandId = brand.brandId
      const days = harriDateRange(startDate, endDate)

      // ---------------------------------------------------------------
      // Phase 1 — daily totals (actual + forecast + categories) + alerts
      //   Run all per-day calls in parallel for the whole range. Each day
      //   issues 4 HTTP calls (3 LPM + 1 alerts). At hourly cron with a
      //   3-day window that's 12 requests per store — fine.
      // ---------------------------------------------------------------
      type PerDay = {
        date: Date
        actual: HarriLaborTotal
        forecast: HarriLaborTotal
        categories: HarriLaborCategoriesResponse
        alerts: HarriAlert[]
      }

      const perDay: PerDay[] = await Promise.all(
        days.map(async (date): Promise<PerDay> => {
          const [actualRes, forecastRes, categoriesRes, alertsRes] = await Promise.allSettled([
            harriFetch<HarriEnvelope<HarriLaborTotal>>(buildLaborActualUrl(brandId, date)),
            harriFetch<HarriEnvelope<HarriLaborTotal>>(buildLaborForecastUrl(brandId, date)),
            harriFetch<HarriEnvelope<HarriLaborCategoriesResponse>>(buildLaborCategoriesUrl(brandId, date)),
            harriFetch<HarriEnvelope<HarriAlertsResponse>>(buildTimekeepingAlertsUrl(brandId, date)),
          ])

          // Report every endpoint that failed, not just the first to reject,
          // so a newly linked brand shows exactly which Harri services refuse it.
          const failures = [forecastRes, categoriesRes, alertsRes].flatMap((r) =>
            r.status === "rejected" ? [errorHead(r.reason)] : []
          )
          if (failures.length > 0) {
            throw new Error(`${failures.join("; ")} (brand ${brandId})`)
          }
          const forecastEnv = (forecastRes as PromiseFulfilledResult<HarriEnvelope<HarriLaborTotal>>).value
          const categoriesEnv = (
            categoriesRes as PromiseFulfilledResult<HarriEnvelope<HarriLaborCategoriesResponse>>
          ).value
          const alertsEnv = (alertsRes as PromiseFulfilledResult<HarriEnvelope<HarriAlertsResponse>>).value

          /*
           * /stats/labor answers 500 on the brands linked 2026-10-26
           * (Van Nuys 20122359, Glendale 20122358) while the other three calls
           * answer — so neither store had ever written a labor row. The
           * categories endpoint carries the same day's total: on Hollywood it
           * equalled /stats/labor on 117 of 118 days since 2026-07-01. Fall
           * back to it rather than dropping the store's labor entirely.
           */
          let actual: HarriLaborTotal
          if (actualRes.status === "fulfilled") {
            actual = actualRes.value.data
          } else if (!isHarriHttpError(actualRes.reason)) {
            // A timeout or network blip is not a refusal: fail the store as before.
            throw actualRes.reason
          } else {
            console.warn(
              `[harri.sync]   ${errorHead(actualRes.reason)}; using categories total for ${date.toISOString().slice(0, 10)}`
            )
            actual = {
              total_labor_cost: categoriesEnv.data.total_labor_cost,
              date: categoriesEnv.data.date,
            }
          }
          return {
            date,
            actual,
            forecast: forecastEnv.data,
            categories: categoriesEnv.data,
            alerts: alertsEnv.data.alerts ?? [],
          }
        })
      )

      // ---------------------------------------------------------------
      // Phase 2 — positions/pay_types, one HTTP call per ISO week.
      //
      // This endpoint is not per-day addressable. Verified 2026-08-18:
      //   from_date=Monday, to_date within that week  -> 200, one entry/day
      //   from_date=Monday, range spilling into next week -> 400
      //   from_date=any non-Monday                    -> 500
      // The previous implementation called it once per day with
      // from_date === to_date, which only ever succeeded when the day
      // happened to be a Monday — every other day 500'd and was swallowed
      // as a "known Harri issue", leaving ~1/7 of the hours data written.
      // Requesting whole Mon..Sun weeks is the only shape it accepts, and
      // it returns the entire week in a single response.
      // ---------------------------------------------------------------
      type PositionsResult =
        | { week: Date; ok: true; data: HarriPositionsPayTypesResponse }
        | { week: Date; ok: false; error: string }

      const weeks = isoWeekStartsCovering(days)

      const positionsByDay: PositionsResult[] = await Promise.all(
        weeks.map(async (weekStart): Promise<PositionsResult> => {
          const weekEnd = new Date(weekStart)
          weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
          try {
            const env = await harriFetch<HarriEnvelope<HarriPositionsPayTypesResponse>>(
              buildPositionsPayTypesUrl(brandId, weekStart, weekEnd)
            )
            return { week: weekStart, ok: true, data: env.data }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { week: weekStart, ok: false, error: msg.slice(0, 200) }
          }
        })
      )

      const positionsFailures = positionsByDay.filter((r) => !r.ok).length
      if (positionsFailures > 0) {
        console.warn(
          `[harri.sync] positions/pay_types: ${positionsFailures}/${positionsByDay.length} weeks failed`
        )
      }

      // ---------------------------------------------------------------
      // Persist daily summaries, positions and alerts: one bulk
      // INSERT ... ON CONFLICT per table (1000-row chunks) that writes only
      // new or changed rows. These were sequential per-row upserts that set
      // syncedAt on every row every run.
      // ---------------------------------------------------------------
      const now = new Date()
      const dailyRows: UpsertRow[] = dedupeByKey(
        perDay.map((p) => ({
          storeId,
          date: startOfUTCDay(p.date),
          actualCost: harriCentsToUSD(p.actual.total_labor_cost),
          forecastCost: harriCentsToUSD(p.forecast.total_labor_cost),
          categories: p.categories.categories.map((c) => ({
            id: c.id,
            code: c.code,
            name: c.name,
            total_labor_cost: harriCentsToUSD(c.total_labor_cost),
          })),
        })),
        (r) => r.date.toISOString(),
      )
      const daysWritten = dailyRows.length
      let rowsChanged = await upsertChangedRows(prisma, HARRI_DAILY_LABOR_UPSERT, dailyRows, {
        now,
      })

      // Per-position rows from whichever weeks Harri returned. Each returned
      // week is the whole truth for its days, so a position that no longer
      // appears on one of them (a shift moved to another position, a pay type
      // corrected) is deleted in the same transaction as the upsert. A week
      // whose request failed returns no days, so its rows are kept.
      const positionRows: UpsertRow[] = dedupeByKey(
        positionsByDay.flatMap((result) =>
          result.ok
            ? result.data.days.flatMap((day) => {
                const date = parseHarriDateOnly(day.date)
                return expandPositionsForDay(day).map((row) => ({ storeId, date, ...row }))
              })
            : [],
        ),
        (r) =>
          `${r.date.toISOString()}|${r.categoryCode}|${r.positionCode}|${r.payType}`,
      )
      const positionsWritten = positionRows.length
      const reconciledDates = positionsByDay.flatMap((result) =>
        result.ok ? result.data.days.map((day) => day.date) : [],
      )
      const deleteStalePositions = buildDeleteMissingSql({
        table: HARRI_POSITION_DAILY_UPSERT.table,
        where: [{ column: { name: "storeId", type: "text" }, value: storeId }],
        dates: { column: "date", values: reconciledDates },
        key: HARRI_POSITION_DAILY_UPSERT.conflict.filter((c) => c.name !== "storeId"),
        keep: positionRows,
      })
      const positionWrites = await prisma.$transaction([
        ...planChangedUpserts(HARRI_POSITION_DAILY_UPSERT, positionRows, { now }).map(({ sql }) =>
          prisma.$executeRaw(sql),
        ),
        ...(deleteStalePositions ? [prisma.$executeRaw(deleteStalePositions)] : []),
      ])
      rowsChanged += positionWrites.reduce((sum, n) => sum + n, 0)

      // Alerts. A repeated alert id keeps its first sighting's insert-only
      // fields and its last sighting's timing fields — what the sequential
      // create-then-update did.
      const alertsById = new Map<string, UpsertRow>()
      for (const p of perDay) {
        for (const a of p.alerts) {
          const id = String(a.id)
          const timing = {
            alertTime: new Date(a.alert_time),
            alertCode: a.alert_type.code,
            alertTypeId: a.alert_type.id,
            timeDiffSec: a.extra_info?.time_diff ?? null,
            missedClockAt: a.extra_info?.missed_clock_at
              ? new Date(a.extra_info.missed_clock_at)
              : null,
          }
          const first = alertsById.get(id)
          alertsById.set(
            id,
            first
              ? { ...first, ...timing }
              : {
                  harriAlertId: id,
                  storeId,
                  date: startOfUTCDay(p.date),
                  employeeId: a.employee_id,
                  userId: a.user_id,
                  positionId: a.position?.id ?? null,
                  positionCode: a.position?.code ?? null,
                  positionName: a.position?.name ?? null,
                  categoryCode: a.position?.category?.code ?? null,
                  ...timing,
                },
          )
        }
      }
      const alertRows = [...alertsById.values()]
      const alertsWritten = alertRows.length
      rowsChanged += await upsertChangedRows(prisma, HARRI_ALERT_UPSERT, alertRows, { now })

      await prisma.harriBrand.update({
        where: { id: brand.id },
        data: { lastSyncAt: new Date() },
      })

      // Surface positions endpoint health on the JobRun row so a recurring
      // gateway issue is visible without grepping container logs.
      if (positionsFailures > 0) {
        const failedDates = positionsByDay
          .filter((r): r is Extract<PositionsResult, { ok: false }> => !r.ok)
          .map((r) => ({ weekStart: r.week.toISOString().slice(0, 10), error: r.error }))
        await prisma.jobRun
          .update({
            where: { id: jobRunId },
            data: {
              metadata: {
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                positionsWeeksTotal: positionsByDay.length,
                positionsWeeksOk: positionsByDay.length - positionsFailures,
                positionsWeeksFailed: positionsFailures,
                positionsFailures: failedDates.slice(0, 30),
              },
            },
          })
          .catch(() => {})
      }

      addRows(daysWritten + positionsWritten + alertsWritten)
      return { daysWritten, positionsWritten, alertsWritten, rowsChanged }
    }
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startOfUTCDay(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}
/** Parse "YYYY-MM-DD" as a UTC midnight Date (matches @db.Date semantics). */
function parseHarriDateOnly(s: string): Date {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

type PositionRowInput = {
  categoryCode: string
  categoryName: string | null
  positionCode: string
  positionName: string | null
  payType: "HOURLY" | "SALARIED"
  totalLabor: number | null
  netAmount: number | null
  overtimeAmount: number | null
  bonusAmount: number | null
  totalShiftCount: number | null
  actualSeconds: number | null
  userIds: number[]
  rawCost: Prisma.InputJsonValue | typeof Prisma.JsonNull
}

function expandPositionsForDay(day: HarriDayBreakdown): PositionRowInput[] {
  const out: PositionRowInput[] = []
  for (const cat of day.categories) {
    for (const pos of cat.positions) {
      const hourly = pos.hourly
      const salaried = pos.salaried
      if (hourly) {
        out.push({
          categoryCode: cat.code,
          categoryName: cat.name,
          positionCode: pos.code,
          positionName: pos.name,
          payType: "HOURLY",
          totalLabor: harriCentsToUSD(hourly.total_labor),
          netAmount: harriCentsToUSD(hourly.cost?.net_amount ?? null),
          overtimeAmount: harriCentsToUSD(hourly.cost?.overtime_amount ?? null),
          bonusAmount: harriCentsToUSD(hourly.cost?.bonus_amount ?? null),
          totalShiftCount: hourly.total_shift_count ?? 0,
          actualSeconds: hourly.actual_seconds ?? 0,
          userIds: hourly.user_ids ?? [],
          rawCost: (hourly.cost as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        })
      }
      if (salaried) {
        out.push({
          categoryCode: cat.code,
          categoryName: cat.name,
          positionCode: pos.code,
          positionName: pos.name,
          payType: "SALARIED",
          totalLabor: harriCentsToUSD(salaried.total_labor),
          netAmount: harriCentsToUSD(salaried.cost?.net_amount ?? null),
          overtimeAmount: harriCentsToUSD(salaried.cost?.overtime_amount ?? null),
          bonusAmount: harriCentsToUSD(salaried.cost?.bonus_amount ?? null),
          totalShiftCount: salaried.total_shift_count ?? 0,
          actualSeconds: salaried.actual_seconds ?? 0,
          userIds: salaried.user_ids ?? [],
          rawCost: (salaried.cost as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        })
      }
    }
  }
  return out
}
