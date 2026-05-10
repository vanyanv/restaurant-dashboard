/**
 * Harri team-directory refresh.
 *
 * Resolves Harri user_ids to first/last names so the labor dashboard can
 * render "Vardan A." instead of "user #1135033". Designed for a monthly
 * cron — names change rarely and the bulk-users endpoint is the only path
 * that sends a Harri API call from this codebase outside the labor sync.
 *
 * The labor sync (src/lib/harri-labor-sync.ts) intentionally does NOT call
 * this — keep the hourly hot path fast.
 */

import { prisma } from "@/lib/prisma"
import { withJobRun } from "@/lib/monitoring/job-run"
import { buildTeamUsersUrl, harriFetch, type HarriUser } from "@/lib/harri"

const CHUNK_SIZE = 10

export type RefreshHarriEmployeesTrigger =
  | "cron"
  | "manual"
  | "webhook"
  | "github-actions"
  | "internal"

export type RefreshHarriEmployeesOpts = {
  storeId: string
  brandId: number
  triggeredBy: RefreshHarriEmployeesTrigger
}

export type RefreshHarriEmployeesResult = {
  requested: number
  fetched: number
  upserted: number
}

export async function refreshHarriEmployees(
  opts: RefreshHarriEmployeesOpts
): Promise<RefreshHarriEmployeesResult> {
  const { storeId, brandId, triggeredBy } = opts

  return withJobRun(
    "harri-employee-sync",
    { storeId, triggeredBy, metadata: { brandId } },
    async ({ addRows }) => {
      // Pull every userId we've ever seen in alerts for this store. Distinct
      // gives us a stable, bounded list — no need to paginate the directory.
      const seen = await prisma.harriTimekeepingAlert.findMany({
        where: { storeId },
        distinct: ["userId"],
        select: { userId: true },
      })
      const userIds = seen.map((r) => r.userId).filter((n) => Number.isFinite(n) && n > 0)

      if (userIds.length === 0) {
        return { requested: 0, fetched: 0, upserted: 0 }
      }

      let fetched = 0
      let upserted = 0
      for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
        const chunk = userIds.slice(i, i + CHUNK_SIZE)
        let payload: { data?: HarriUser[] }
        try {
          payload = await harriFetch<{ data?: HarriUser[] }>(buildTeamUsersUrl(brandId, chunk))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.warn(`[harri.employees] chunk failed for ${chunk.join(",")}: ${msg.slice(0, 200)}`)
          continue
        }
        const users = payload.data ?? []
        fetched += users.length

        for (const u of users) {
          if (!u.id || !Number.isFinite(u.id)) continue
          await prisma.harriEmployee.upsert({
            where: { storeId_userId: { storeId, userId: u.id } },
            create: {
              storeId,
              brandId,
              userId: u.id,
              employeeId: u.employee_id ?? null,
              firstName: u.first_name ?? null,
              lastName: u.last_name ?? null,
              email: u.email ?? null,
              status: u.status ?? null,
            },
            update: {
              brandId,
              employeeId: u.employee_id ?? null,
              firstName: u.first_name ?? null,
              lastName: u.last_name ?? null,
              email: u.email ?? null,
              status: u.status ?? null,
              syncedAt: new Date(),
            },
          })
          upserted += 1
        }
      }

      addRows(upserted)
      return { requested: userIds.length, fetched, upserted }
    }
  )
}
