import { NextResponse } from "next/server"
import { withCronAuth } from "@/lib/cron-auth"
import { runHourlySync } from "@/lib/hourly-sync"
import { bustTags } from "@/lib/cache/cached"

export const maxDuration = 60

// Allow cron (CRON_SECRET bearer) or authenticated owner for manual triggers.
export const POST = withCronAuth(
  async (_request, { fromCron }) => {
    try {
      const result = await runHourlySync({
        triggeredBy: fromCron ? "cron" : "manual",
      })
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
  },
  { ownerFallback: { forbiddenMessage: "Only owners can run the hourly sync" } }
)
