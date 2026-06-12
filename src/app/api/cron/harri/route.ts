import { NextResponse } from "next/server"
import { withCronAuth, parseJsonBody } from "@/lib/cron-auth"
import { runHarriLaborSync } from "@/lib/harri-labor-sync"
import { bustTags } from "@/lib/cache/cached"

export const maxDuration = 60

/**
 * Per-store Harri labor sync. Re-syncs the last 3 days because managers
 * can edit punches retroactively in Harri (so today's totals can change
 * for yesterday). Auth: CRON_SECRET bearer for cron, owner session for
 * manual triggers.
 */
export const POST = withCronAuth(
  async (request, { fromCron }) => {
    const body = await parseJsonBody<{ storeId?: string; days?: number }>(request)
    if (body instanceof NextResponse) return body

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
  },
  { ownerFallback: { forbiddenMessage: "Only owners can run the Harri sync" } }
)
