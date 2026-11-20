import { NextResponse } from "next/server"
import { withCronAuth } from "@/lib/cron-auth"
import { withJobRun } from "@/lib/monitoring/job-run"
import { CHECK_ALERTS_JOB, checkAlertAccountsDue, recordCheckAlerts } from "@/lib/checks/missed-alerts"

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
 * unsure.
 */
export const POST = withCronAuth(async () => {
  const now = new Date()
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
