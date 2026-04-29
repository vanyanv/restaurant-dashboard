import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isCronRequest, rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
import { runHourlySync } from "@/lib/hourly-sync"
import { bustTags } from "@/lib/cache/cached"

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.strict)
  if (limited) return limited

  // Allow cron (CRON_SECRET bearer) or authenticated owner for manual triggers.
  const fromCron = isCronRequest(request)
  if (!fromCron) {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "OWNER") {
      return NextResponse.json(
        { error: "Only owners can run the hourly sync" },
        { status: 403 }
      )
    }
  }

  try {
    const result = await runHourlySync()
    if (result.bucketsWritten > 0) {
      await bustTags(["otter", "dash", "pnl"])
    }
    return NextResponse.json(result)
  } catch (error) {
    console.error("Otter hourly sync error:", error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    )
  }
}
