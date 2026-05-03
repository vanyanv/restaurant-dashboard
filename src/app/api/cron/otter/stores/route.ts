import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isCronRequest } from "@/lib/rate-limit"
import { withJobRun } from "@/lib/monitoring/job-run"

/**
 * Enumerate active stores plus their Otter UUIDs for matrix fan-out from
 * GitHub Actions. The otter-sync / otter-drain workflows hit this first and
 * then expand `[.stores[].storeId]` into a per-store matrix so each
 * downstream sync shard is bounded to one store. Each shard re-resolves
 * UUIDs from Prisma, so the otterStoreIds array here is informational —
 * useful for the workflow log but not load-bearing.
 *
 * Distinct from /api/cron/cogs/stores because Otter has the
 * (store → otterStoreIds[]) relationship to surface; COGS just needs Store rows.
 */
export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const stores = await withJobRun(
    "otter.stores",
    { triggeredBy: "github-actions" },
    async ({ addRows }) => {
      const otterStores = await prisma.otterStore.findMany({
        include: { store: { select: { id: true, name: true, isActive: true } } },
      })
      const active = otterStores.filter((os) => os.store.isActive)

      const grouped = new Map<string, { storeId: string; name: string; otterStoreIds: string[] }>()
      for (const os of active) {
        const existing = grouped.get(os.storeId)
        if (existing) {
          existing.otterStoreIds.push(os.otterStoreId)
        } else {
          grouped.set(os.storeId, {
            storeId: os.storeId,
            name: os.store.name,
            otterStoreIds: [os.otterStoreId],
          })
        }
      }

      const rows = [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name))
      addRows(rows.length)
      return rows
    },
  )

  return NextResponse.json({ stores })
}
