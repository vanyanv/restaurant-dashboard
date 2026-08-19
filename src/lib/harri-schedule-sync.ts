/**
 * Harri schedule sync — pulls published shifts week by week and upserts them
 * into HarriShift.
 *
 * The endpoint is week-addressable only (`week` = the Monday), so the unit of
 * work is an ISO week, same as the positions/pay_types phase of
 * harri-labor-sync.
 *
 * This IS a forward-looking source. An earlier note here called it
 * backward-looking on the grounds that unpublished weeks come back empty —
 * true, but the published horizon runs about two weeks out. Probed 2026-08-19:
 * week +0 returned 64 shifts, week +1 returned 63 (437h, Aug 24-30), weeks +2
 * and +3 were empty. Because that note said not to forecast on it, nothing did:
 * the staffing classifier read HarriDailyLabor.forecastCost instead, which has
 * no forward rows, and /dashboard/decisions showed "no schedule" for a week the
 * manager had already published.
 *
 * Callers should use `scheduleSyncWindow()` for the bounds.
 */

import { prisma } from "@/lib/prisma"
import { withJobRun } from "@/lib/monitoring/job-run"
import { buildScheduleWeekUrl, harriFetch, type HarriEnvelope } from "@/lib/harri"
import { flattenSchedule, type HarriScheduleResponse } from "@/lib/harri-schedule"
import { isoMondayUTC, isoWeekStartsCovering, addDaysUTC } from "@/lib/labor-week"

export type HarriScheduleSyncResult = {
  weeksRequested: number
  weeksOk: number
  shiftsWritten: number
  /** Weeks the gateway served but that carried no published schedule. */
  weeksEmpty: number
}

export async function runHarriScheduleSync(opts: {
  storeId: string
  startDate: Date
  endDate: Date
  triggeredBy: "cron" | "manual" | "github-actions" | "internal"
}): Promise<HarriScheduleSyncResult> {
  const { storeId, startDate, endDate, triggeredBy } = opts

  return withJobRun(
    "harri-schedule-sync",
    {
      storeId,
      triggeredBy,
      metadata: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    },
    async ({ addRows }) => {
      const brand = await prisma.harriBrand.findFirst({
        where: { storeId, active: true },
      })
      if (!brand) {
        throw new Error(`No active HarriBrand mapping for storeId=${storeId}`)
      }

      // Enumerate every Monday between the bounds.
      const days: Date[] = []
      for (
        let d = isoMondayUTC(startDate);
        d <= endDate;
        d = addDaysUTC(d, 7)
      ) {
        days.push(d)
      }
      const weeks = isoWeekStartsCovering(days)

      let weeksOk = 0
      let weeksEmpty = 0
      let shiftsWritten = 0

      for (const weekStart of weeks) {
        let data: HarriScheduleResponse
        try {
          const env = await harriFetch<HarriEnvelope<HarriScheduleResponse>>(
            buildScheduleWeekUrl(brand.brandId, weekStart)
          )
          data = env.data
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.warn(
            `[harri.schedule] week ${weekStart.toISOString().slice(0, 10)} failed: ${msg.slice(0, 160)}`
          )
          continue
        }

        weeksOk += 1
        const rows = flattenSchedule(data, weekStart)
        if (rows.length === 0) {
          weeksEmpty += 1
          continue
        }

        // Replace the week wholesale: a manager editing the published schedule
        // can delete shifts, and an upsert-only pass would leave the deleted
        // ones behind as phantom staffed hours.
        await prisma.$transaction([
          prisma.harriShift.deleteMany({ where: { storeId, weekStart } }),
          prisma.harriShift.createMany({
            data: rows.map((r) => ({ storeId, ...r })),
            skipDuplicates: true,
          }),
        ])
        shiftsWritten += rows.length
      }

      addRows(shiftsWritten)
      return {
        weeksRequested: weeks.length,
        weeksOk,
        weeksEmpty,
        shiftsWritten,
      }
    }
  )
}
