import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withCronAuth } from "@/lib/cron-auth"
import { withJobRun } from "@/lib/monitoring/job-run"
import { otterStoresToSync } from "@/lib/otter-stores-to-sync"

/**
 * Enumerate active stores plus their Otter UUIDs for matrix fan-out from
 * GitHub Actions. The otter-sync / otter-drain workflows hit this first and
 * then expand `[.stores[].storeId]` into a per-store matrix so each
 * downstream sync shard is bounded to one store. Each shard re-resolves
 * UUIDs from Prisma, so the otterStoreIds array here is informational —
 * useful for the workflow log but not load-bearing.
 *
 * `?skipRecent=1` (otter-sync.yml, on a run with no explicit lookback) leaves
 * out every store whose metrics sync succeeded in the last 20 minutes: the
 * sync ticker dispatches the 4-hourly run on time and the workflow's backup
 * `schedule:` often fires the same window again later. When that leaves no
 * store the answer is `{ stores: [], skipped: "recent-success" }`, nothing
 * is written, and the empty matrix skips the sync and proposal jobs.
 *
 * Distinct from /api/cron/cogs/stores because Otter has the
 * (store → otterStoreIds[]) relationship to surface; COGS just needs Store rows.
 */
export const GET = withCronAuth(async (request) => {
  const skipRecent = new URL(request.url).searchParams.get("skipRecent") === "1"

  let candidates: Awaited<ReturnType<typeof otterStoresToSync>> | null = null
  const result = await withJobRun(
    "otter.stores",
    {
      triggeredBy: "github-actions",
      ...(skipRecent ? { metadata: { skipRecent } } : {}),
      skipIf: async () => {
        if (!skipRecent) return null
        candidates = await otterStoresToSync({ skipRecent })
        // Nothing active at all is not a duplicate run: record it as before.
        if (candidates.active === 0 || candidates.stores.length > 0) return null
        return { skipped: "recent-success" as const, stores: [] as const }
      },
    },
    async ({ addRows }) => {
      const { stores, recent } = candidates ?? (await otterStoresToSync({ skipRecent }))
      addRows(stores.length)
      return { stores, ...(recent.length > 0 ? { skippedRecent: recent } : {}) }
    },
  )

  return NextResponse.json(result)
})
