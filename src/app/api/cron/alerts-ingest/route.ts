import { NextResponse } from "next/server"
import { withCronAuth } from "@/lib/cron-auth"
import { withJobRun } from "@/lib/monitoring/job-run"
import { ingestFromAnomalyEvents } from "@/lib/alerts/ingest"
import { logger } from "@/lib/logger"

export const maxDuration = 120

/**
 * F21 — Alert ingest. Runs after `ml-nightly` finishes; scans the
 * most-recently-detected AnomalyEvents and upserts them into the Alert
 * inbox. Idempotent: `Alert.dedupeKey` is unique, and a re-run preserves
 * any operator triage (status / explanation / acknowledgedAt).
 *
 * Future phases append additional sources here (PRICE_DELTA, HARRI_VARIANCE,
 * QUANTITY_SPIKE, NEW_PRODUCT). Phase 1 ships ANOMALY_EVENT only.
 */
export const POST = withCronAuth(async (request) => {
  let body: { sinceDays?: number } = {}
  try {
    body = await request.json()
  } catch {
    // Empty body is fine — defaults apply.
  }

  const result = await withJobRun(
    "alerts.ingest",
    { triggeredBy: "github-actions" },
    async ({ addRows }) => {
      const out = await ingestFromAnomalyEvents({ sinceDays: body.sinceDays })
      addRows(out.created + out.updated)
      logger.info("[alerts-ingest]", out)
      return out
    },
  )

  return NextResponse.json(result)
})
