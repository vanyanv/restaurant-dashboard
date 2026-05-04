import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isCronRequest } from "@/lib/rate-limit"
import { withJobRun } from "@/lib/monitoring/job-run"

/**
 * Enumerate active store IDs for matrix fan-out from GitHub Actions. The
 * cogs-sweep / cogs-refresh workflows hit this first, then expand the result
 * into a per-store matrix so each downstream sweep call is bounded to one
 * store and stays well under Vercel's function timeout.
 */
export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const force = url.searchParams.get("force") === "true"

  const result = await withJobRun(
    "cogs.stores",
    { triggeredBy: "github-actions", metadata: { force } },
    async ({ addRows }) => {
      const activeStores = await prisma.store.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          accountId: true,
          _count: {
            select: {
              otterMenuItems: true,
              otterOrders: true,
            },
          },
        },
        orderBy: { name: "asc" },
      })

      const rows = (force
        ? activeStores
        : activeStores.filter(
            (store) =>
              store._count.otterMenuItems > 0 || store._count.otterOrders > 0,
          )
      ).map(({ _count, ...store }) => store)

      addRows(rows.length)
      return {
        stores: rows,
        activeStoreCount: activeStores.length,
        skippedEmptyStoreCount: activeStores.length - rows.length,
        force,
      }
    }
  )

  return NextResponse.json(result)
}
