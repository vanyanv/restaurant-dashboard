import { NextResponse } from "next/server"
import { withCronAuth } from "@/lib/cron-auth"
import { withJobRun } from "@/lib/monitoring/job-run"
import { recordCheckAlerts } from "@/lib/checks/missed-alerts"

/**
 * Store checks — puts missed and late checks on Needs you. Called by
 * `.github/workflows/checks-cron.yml` every half hour; idempotent.
 */
export const POST = withCronAuth(async () => {
  const result = await withJobRun("checks.alerts", { triggeredBy: "github-actions" }, async ({ addRows }) => {
    const out = await recordCheckAlerts({ now: new Date() })
    addRows(out.created)
    return out
  })
  return NextResponse.json(result)
})
