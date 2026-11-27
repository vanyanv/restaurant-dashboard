import { NextResponse } from "next/server"
import { withCronAuth } from "@/lib/cron-auth"
import { withJobRun } from "@/lib/monitoring/job-run"
import { CHECK_ALERTS_JOB, checkAlertAccountsDue, recordCheckAlerts } from "@/lib/checks/missed-alerts"
import { checksQuiet } from "@/lib/checks/quiet"

/**
 * Store checks — puts missed and late checks on Needs you, and closes any
 * check whose window ended with nobody pressing Submit (`loadCheckGrid`'s
 * auto-close; the crew page is read-only and relies on this). Called by
 * `.github/workflows/checks-cron.yml` every half hour; idempotent.
 *
 * Most half-hours no check window has gone past due or closed since the last
 * run, and then nothing can have changed: the run answers
 * `{ skipped: "no-check-window" }` without loading the grid or writing a
 * JobRun row. `checkAlertAccountsDue` decides, and says "run" whenever it is
 * unsure. When it last decided "skip" it also saved, in Redis, how long that
 * answer holds (`checks/quiet.ts`); inside that time the run answers the same
 * without touching the database, so the Neon compute can stay asleep.
 */
export const POST = withCronAuth(async () => {
  const now = new Date()
  if (await checksQuiet(now)) return NextResponse.json({ skipped: "no-check-window", from: "cache" })
  let accountIds: string[] | null = null
  const result = await withJobRun(
    CHECK_ALERTS_JOB,
    {
      triggeredBy: "github-actions",
      skipIf: async () => {
        accountIds = await checkAlertAccountsDue(now)
        return accountIds !== null && accountIds.length === 0
          ? { skipped: "no-check-window" as const }
          : null
      },
    },
    async ({ addRows }) => {
      const out = await recordCheckAlerts({ now, accountIds: accountIds ?? undefined })
      addRows(out.created)
      return out
    },
  )
  return NextResponse.json(result)
})
