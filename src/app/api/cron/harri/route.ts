import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { isCronRequest, rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
import { runHarriLaborSync } from "@/lib/harri-labor-sync"
import { bustTags } from "@/lib/cache/cached"

export const maxDuration = 60

/**
 * Per-store Harri labor sync. Re-syncs the last 3 days because managers
 * can edit punches retroactively in Harri (so today's totals can change
 * for yesterday). Auth: CRON_SECRET bearer for cron, owner session for
 * manual triggers.
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
        { error: "Only owners can run the Harri sync" },
        { status: 403 }
      )
    }
  }

  let body: { storeId?: string; days?: number } = {}
  try {
    body = (await request.json()) as { storeId?: string; days?: number }
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }

  const storeId = body.storeId
  if (!storeId || typeof storeId !== "string") {
    return NextResponse.json({ error: "storeId required" }, { status: 400 })
  }

  const days = Math.max(1, Math.min(14, body.days ?? 3))
  const endDate = new Date()
  endDate.setUTCHours(0, 0, 0, 0)
  const startDate = new Date(endDate)
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1))

  try {
    const result = await runHarriLaborSync({
      storeId,
      startDate,
      endDate,
      triggeredBy: fromCron ? "cron" : "manual",
    })
    if (result.daysWritten > 0) {
      await bustTags(["harri", "pnl", "dash"])
    }
    return NextResponse.json({ storeId, days, ...result })
  } catch (error) {
    console.error("Harri labor sync error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
