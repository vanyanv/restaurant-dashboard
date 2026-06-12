import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withCronAuth } from "@/lib/cron-auth"
import { withJobRun } from "@/lib/monitoring/job-run"

/**
 * Enumerate active stores that have a Harri brand mapping configured. The
 * GitHub Actions harri-cron workflow hits this first and then expands
 * `[.stores[].storeId]` into a per-store matrix so each shard is bounded
 * to one store. Mirrors /api/cron/otter/stores.
 */
export const GET = withCronAuth(async () => {
  const stores = await withJobRun(
    "harri.stores",
    { triggeredBy: "github-actions" },
    async ({ addRows }) => {
      const harriBrands = await prisma.harriBrand.findMany({
        where: { active: true },
        include: { store: { select: { id: true, name: true, isActive: true } } },
      })
      const active = harriBrands.filter((hb) => hb.store.isActive)

      const rows = active
        .map((hb) => ({
          storeId: hb.storeId,
          name: hb.store.name,
          harriBrandId: hb.brandId,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      addRows(rows.length)
      return rows
    }
  )

  return NextResponse.json({ stores })
})
