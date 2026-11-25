import { NextResponse } from "next/server"
import { withCronAuth } from "@/lib/cron-auth"
import { runHourlySync } from "@/lib/hourly-sync"
import { bustTags, monthTagsForDates } from "@/lib/cache/cached"
import { withScopedWrites } from "@/lib/cache/closed-range"

export const maxDuration = 60

// Allow cron (CRON_SECRET bearer) or authenticated owner for manual triggers.
export const POST = withCronAuth(
  async (_request, { fromCron, accountId }) => {
    try {
      // Scoped: the sync rewrites today and yesterday only, so afterwards it
      // retires the saved figures of exactly those days, and last week's stay.
      // A run that changed no bucket wrote nothing, and retires nothing.
      let written: string[] | null = null
      const result = await withScopedWrites(
        () => {
          // Null only if the sync threw before saying what it wrote; then
          // the global bump is the safe answer.
          if (!written) throw new Error("unknown dates")
          return written
        },
        async () => {
          // A manual trigger syncs the caller's own account's stores only;
          // cron (accountId null) syncs every store, as before.
          const r = await runHourlySync({
            triggeredBy: fromCron ? "cron" : "manual",
            ...(accountId ? { accountId } : {}),
          })
          written = r.bucketsChanged > 0 ? r.datesCovered : []
          return r
        },
      )
      // Only when a bucket actually changed: most hourly runs re-read a window
      // that has not moved, and busting on "rows exist" evicted every hour.
      if (result.bucketsChanged > 0) {
        /*
         * NOT `"pnl"`. This route runs every hour and writes a two-day window
         * (today + yesterday); busting the broad tag threw away every cached
         * statement for every range, including the seven trailing weeks it did
         * not touch — which is why the 600s TTL never got to matter.
         *
         * `datesCovered` is what the sync ACTUALLY wrote, so a backfill that
         * reaches further back busts those months too. Otter does revise closed
         * windows, so deriving the months from "today" instead would miss them.
         *
         * "otter" and "dash" stay broad: those entries are not keyed by date.
         */
        await bustTags([
          "otter",
          "dash",
          ...monthTagsForDates(result.datesCovered),
        ])
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
