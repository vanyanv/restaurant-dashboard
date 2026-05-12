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
          const [actualEnv, forecastEnv, categoriesEnv, alertsEnv] = await Promise.all([
            harriFetch<HarriEnvelope<HarriLaborTotal>>(buildLaborActualUrl(brandId, date)),
            harriFetch<HarriEnvelope<HarriLaborTotal>>(buildLaborForecastUrl(brandId, date)),
            harriFetch<HarriEnvelope<HarriLaborCategoriesResponse>>(buildLaborCategoriesUrl(brandId, date)),
            harriFetch<HarriEnvelope<HarriAlertsResponse>>(buildTimekeepingAlertsUrl(brandId, date)),
          ])
          return {
            date,
            actual: actualEnv.data,
            forecast: forecastEnv.data,
            categories: categoriesEnv.data,
            alerts: alertsEnv.data.alerts ?? [],
          }
        })
      )

      // ---------------------------------------------------------------
      // Phase 2 — positions/pay_types, one HTTP call per day.
      //
      // Harri's gateway 500s on this endpoint for most dates (verified
      // 2026-05-12: 7 of 8 recent days return 500, one returns 200). A
      // single multi-day call therefore fails whenever ANY day in the
      // range is bad, which means a wide-window cron writes nothing. By
      // looping per-day we capture whatever days the gateway happens to
      // serve, and a per-day failure doesn't poison the rest. Failures
      // are aggregated into positionsFailures and surfaced on the JobRun
      // row so the issue stays visible.
      // ---------------------------------------------------------------
      type PositionsResult =
        | { date: Date; ok: true; data: HarriPositionsPayTypesResponse }
        | { date: Date; ok: false; error: string }

      const positionsByDay: PositionsResult[] = await Promise.all(
        days.map(async (date): Promise<PositionsResult> => {
          try {
            const env = await harriFetch<HarriEnvelope<HarriPositionsPayTypesResponse>>(
              buildPositionsPayTypesUrl(brandId, date, date)
            )
            return { date, ok: true, data: env.data }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { date, ok: false, error: msg.slice(0, 200) }
          }
        })
      )

      const positionsFailures = positionsByDay.filter((r) => !r.ok).length
      if (positionsFailures > 0) {
        console.warn(
          `[harri.sync] positions/pay_types: ${positionsFailures}/${positionsByDay.length} days failed (Harri gateway 500s — known issue)`
        )
      }

      // ---------------------------------------------------------------
      // Persist daily summaries
      // ---------------------------------------------------------------
      let daysWritten = 0
      for (const p of perDay) {
        const dateOnly = startOfUTCDay(p.date)
        const categoriesJson = p.categories.categories.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          total_labor_cost: harriCentsToUSD(c.total_labor_cost),
        }))
        await prisma.harriDailyLabor.upsert({
          where: { storeId_date: { storeId, date: dateOnly } },
          create: {
            storeId,
            date: dateOnly,
            actualCost: harriCentsToUSD(p.actual.total_labor_cost),
            forecastCost: harriCentsToUSD(p.forecast.total_labor_cost),
            categories: categoriesJson,
          },
          update: {
            actualCost: harriCentsToUSD(p.actual.total_labor_cost),
            forecastCost: harriCentsToUSD(p.forecast.total_labor_cost),
            categories: categoriesJson,
            syncedAt: new Date(),
          },
        })
        daysWritten += 1
      }

      // ---------------------------------------------------------------
      // Persist per-position rows from whichever days Harri returned.
      // ---------------------------------------------------------------
      let positionsWritten = 0
      for (const result of positionsByDay) {
        if (!result.ok) continue
        for (const day of result.data.days) {
          const dateOnly = parseHarriDateOnly(day.date)
          for (const row of expandPositionsForDay(day)) {
            await prisma.harriPositionDaily.upsert({
              where: {
                storeId_date_categoryCode_positionCode_payType: {
                  storeId,
                  date: dateOnly,
                  categoryCode: row.categoryCode,
                  positionCode: row.positionCode,
                  payType: row.payType,
                },
              },
              create: { storeId, date: dateOnly, ...row },
              update: { ...row, syncedAt: new Date() },
            })
            positionsWritten += 1
          }
        }
      }

      // ---------------------------------------------------------------
      // Persist alerts
      // ---------------------------------------------------------------
      let alertsWritten = 0
      for (const p of perDay) {
        for (const a of p.alerts) {
          const dateOnly = startOfUTCDay(p.date)
          await prisma.harriTimekeepingAlert.upsert({
            where: { harriAlertId: BigInt(a.id) },
            create: {
              harriAlertId: BigInt(a.id),
              storeId,
              date: dateOnly,
              employeeId: a.employee_id,
              userId: a.user_id,
              positionId: a.position?.id ?? null,
              positionCode: a.position?.code ?? null,
              positionName: a.position?.name ?? null,
              categoryCode: a.position?.category?.code ?? null,
              alertTime: new Date(a.alert_time),
              alertCode: a.alert_type.code,
              alertTypeId: a.alert_type.id,
              timeDiffSec: a.extra_info?.time_diff ?? null,
              missedClockAt: a.extra_info?.missed_clock_at
                ? new Date(a.extra_info.missed_clock_at)
                : null,
            },
            update: {
              alertTime: new Date(a.alert_time),
              alertCode: a.alert_type.code,
              alertTypeId: a.alert_type.id,
              timeDiffSec: a.extra_info?.time_diff ?? null,
              missedClockAt: a.extra_info?.missed_clock_at
                ? new Date(a.extra_info.missed_clock_at)
                : null,
              syncedAt: new Date(),
            },
          })
          alertsWritten += 1
        }
      }

      await prisma.harriBrand.update({
        where: { id: brand.id },
        data: { lastSyncAt: new Date() },
      })

      // Surface positions endpoint health on the JobRun row so a recurring
      // gateway issue is visible without grepping container logs.
      if (positionsFailures > 0) {
        const failedDates = positionsByDay
          .filter((r): r is Extract<PositionsResult, { ok: false }> => !r.ok)
          .map((r) => ({ date: r.date.toISOString().slice(0, 10), error: r.error }))
        await prisma.jobRun
          .update({
            where: { id: jobRunId },
            data: {
              metadata: {
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                positionsDaysTotal: positionsByDay.length,
                positionsDaysOk: positionsByDay.length - positionsFailures,
                positionsDaysFailed: positionsFailures,
                positionsFailures: failedDates.slice(0, 30),
              },
            },
          })
          .catch(() => {})
      }

      addRows(daysWritten + positionsWritten + alertsWritten)
      return { daysWritten, positionsWritten, alertsWritten }
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
