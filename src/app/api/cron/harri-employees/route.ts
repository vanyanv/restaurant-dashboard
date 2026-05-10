import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { isCronRequest, rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
import { prisma } from "@/lib/prisma"
import { refreshHarriEmployees } from "@/lib/harri-employee-sync"
import { bustTags } from "@/lib/cache/cached"

export const maxDuration = 120

/**
 * Monthly Harri team-directory refresh. Iterates every active HarriBrand and
 * upserts first/last names for every userId that ever appeared in an alert
 * for that store. The labor cron does NOT call this — names change rarely
 * and the bulk-users endpoint is rate-limited (10 ids per call).
 */
export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.strict)
  if (limited) return limited

  const fromCron = isCronRequest(request)
  if (!fromCron) {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (!hasOwnerAccess(session.user.role)) {
      return NextResponse.json(
        { error: "Only owners can run the Harri employee refresh" },
        { status: 403 }
      )
    }
  }

  const brands = await prisma.harriBrand.findMany({
    where: { active: true },
    select: { storeId: true, brandId: true },
    orderBy: { createdAt: "asc" },
  })

  type StoreSummary = {
    storeId: string
    brandId: number
    requested: number
    fetched: number
    upserted: number
    error?: string
  }
  const summaries: StoreSummary[] = []

  for (const b of brands) {
    try {
      const r = await refreshHarriEmployees({
        storeId: b.storeId,
        brandId: b.brandId,
        triggeredBy: fromCron ? "cron" : "manual",
      })
      summaries.push({ storeId: b.storeId, brandId: b.brandId, ...r })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      summaries.push({
        storeId: b.storeId,
        brandId: b.brandId,
        requested: 0,
        fetched: 0,
        upserted: 0,
        error: message.slice(0, 200),
      })
    }
    await new Promise((r) => setTimeout(r, 1_000))
  }

  const totalUpserted = summaries.reduce((a, s) => a + s.upserted, 0)
  if (totalUpserted > 0) {
    await bustTags(["harri", "labor"])
  }

  return NextResponse.json({ brands: brands.length, totalUpserted, summaries })
}
