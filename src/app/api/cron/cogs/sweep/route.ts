import { NextResponse } from "next/server"
import { withCronAuth } from "@/lib/cron-auth"
import {
  CogsSweepFailedError,
  CogsSweepStoreNotFoundError,
  isValidCogsLookback,
  runCogsSweepForStore,
} from "@/lib/cogs-sweep-job"
import { logger } from "@/lib/logger"

export const maxDuration = 300

/**
 * Per-store COGS materialization, by hand.
 *
 * The scheduled sweeps no longer come through here: since 2026-11-26
 * `scripts/sweep-cogs.ts` runs them on the GitHub Actions runner (see
 * `@/lib/cogs-sweep-job` for why). This endpoint stays for a sweep someone
 * triggers themselves, and does exactly what the scheduled one does.
 */
export const POST = withCronAuth(async (request) => {
  const startedAt = Date.now()
  const url = new URL(request.url)
  const storeId = url.searchParams.get("storeId")
  const lookbackDays = Number(url.searchParams.get("lookbackDays") ?? 3)
  const force = url.searchParams.get("force") === "true"

  if (!storeId) {
    return NextResponse.json(
      { error: "storeId query param is required" },
      { status: 400 }
    )
  }
  if (!isValidCogsLookback(lookbackDays)) {
    return NextResponse.json(
      { error: "lookbackDays must be between 1 and 365" },
      { status: 400 }
    )
  }

  try {
    const result = await runCogsSweepForStore({
      storeId,
      lookbackDays,
      force,
      triggeredBy: "github-actions",
    })
    return NextResponse.json({ ...result, durationMs: Date.now() - startedAt })
  } catch (err) {
    if (err instanceof CogsSweepStoreNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    const failedStoreId = err instanceof CogsSweepFailedError ? err.storeId : storeId
    logger.error(`[cron/cogs/sweep] store ${failedStoreId} failed:`, err)
    return NextResponse.json(
      {
        error: "sweep failed",
        message: err instanceof Error ? err.message : String(err),
        storeId: failedStoreId,
        durationMs: Date.now() - startedAt,
      },
      { status: 500 }
    )
  }
})
