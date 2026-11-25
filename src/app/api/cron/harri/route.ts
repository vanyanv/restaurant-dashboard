import { NextResponse } from "next/server"
import { withCronAuth, parseJsonBody } from "@/lib/cron-auth"
import { runHarriLaborSync } from "@/lib/harri-labor-sync"
import { runHarriScheduleSync } from "@/lib/harri-schedule-sync"
import { scheduleSyncWindow } from "@/lib/harri-schedule"
import { bustTags, monthTagsForRange } from "@/lib/cache/cached"
import { laIsoWeeksSpanning, withScopedWrites } from "@/lib/cache/closed-range"
import { businessQueryDate } from "@/lib/counter/business-date"
import { requireOwnerStore } from "@/lib/auth-scope"

// Raised from 60 when the schedule sync joined this route: it adds four
// week-addressable gateway calls plus a transaction each, on top of the labor
// sync. Matches the other multi-phase crons (alerts-ingest, harri-employees).
export const maxDuration = 120

/**
 * Per-store Harri labor sync. Re-syncs the last 3 days because managers
 * can edit punches retroactively in Harri (so today's totals can change
 * for yesterday). Auth: CRON_SECRET bearer for cron, owner session for
 * manual triggers.
 *
 * Also runs the schedule sync, which until 2026-08-19 had no caller but a
 * manual backfill script. HarriDailyLabor carries no forward rows, so the
 * staffing classifier saw `scheduledLaborCost == null` for every future day
 * and reported "no schedule" across the whole week on /dashboard/decisions —
 * while Harri had the next two weeks published the entire time.
 *
 * The schedule half is best-effort: a schedule failure must not lose the
 * labor sync that already succeeded, so it is reported rather than thrown.
 */
export const POST = withCronAuth(
  async (request, { fromCron }) => {
    const body = await parseJsonBody<{ storeId?: string; days?: number }>(request)
    if (body instanceof NextResponse) return body

    const storeId = body.storeId
    if (!storeId || typeof storeId !== "string") {
      return NextResponse.json({ error: "storeId required" }, { status: 400 })
    }

    // A manual trigger is an owner of SOME account; the store must be one of
    // theirs. Without this, an owner of one account could sync (rewrite labour
    // and schedule rows, bust caches of) another account's store by posting
    // its id. "Store not found" either way, so the reply does not say whether
    // another account's store exists. Cron runs every store and is unscoped.
    if (!fromCron) {
      try {
        await requireOwnerStore(storeId)
      } catch {
        return NextResponse.json({ error: "Store not found" }, { status: 404 })
      }
    }

    const days = Math.max(1, Math.min(14, body.days ?? 3))
    // Today's LA business date, in the @db.Date encoding. UTC midnight was
    // already tomorrow from 4-5pm Pacific, so every evening run wrote a labor
    // row for a day that had not started.
    const endDate = businessQueryDate(new Date())
    const startDate = new Date(endDate)
    startDate.setUTCDate(startDate.getUTCDate() - (days - 1))

    try {
      const { startDate: schedStart, endDate: schedEnd } = scheduleSyncWindow()
      // Scoped: afterwards it retires the saved figures of the days it wrote
      // (the weeks around the labour window and the schedule), and no others.
      const { result, schedule } = await withScopedWrites(
        () => [
          // Whole ISO weeks: positions are pulled per week and the schedule
          // replaces whole weeks, so days outside the window are rewritten too.
          ...laIsoWeeksSpanning(startDate.toISOString(), endDate.toISOString()),
          ...laIsoWeeksSpanning(schedStart.toISOString(), schedEnd.toISOString()),
        ],
        async () => {
          const result = await runHarriLaborSync({
            storeId,
            startDate,
            endDate,
            triggeredBy: fromCron ? "cron" : "manual",
          })
          let schedule: Record<string, unknown>
          try {
            schedule = { ...(await runHarriScheduleSync({
              storeId,
              startDate: schedStart,
              endDate: schedEnd,
              triggeredBy: fromCron ? "cron" : "manual",
            })) }
          } catch (error) {
            console.error("Harri schedule sync error:", error)
            schedule = {
              error: error instanceof Error ? error.message : "schedule sync failed",
            }
          }
          return { result, schedule }
        },
      )

      // `rowsChanged`, not `daysWritten`: the labour sync re-reads the same
      // window every run and now rewrites only rows that moved.
      if (result.rowsChanged > 0 || Number(schedule.shiftsWritten ?? 0) > 0) {
        /*
         * The P&L half is busted by month rather than through the broad "pnl"
         * tag — same reason as the hourly Otter route: this runs every four
         * hours over a three-day labour window and used to evict every cached
         * statement for every range.
         *
         * The union of BOTH windows, not just the labour one. The schedule
         * sync writes forward rows, and although the rollup reads only
         * `actualCost` today, a bust that is too narrow shows stale money
         * while one that is too wide costs a refetch — so the wider union is
         * the right side to err on.
         */
        const from = startDate < schedStart ? startDate : schedStart
        const to = endDate > schedEnd ? endDate : schedEnd
        await bustTags(["harri", "dash", ...monthTagsForRange(from, to)])
      }
      return NextResponse.json({ storeId, days, ...result, schedule })
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
