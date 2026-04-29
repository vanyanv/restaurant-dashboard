import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isCronRequest } from "@/lib/rate-limit"
import { recomputeDailyCogsForRange } from "@/lib/cogs-materializer"

export const maxDuration = 300

/**
 * Per-store COGS materialization. One endpoint serves both the hourly sweep
 * (lookbackDays=7) and the daily refresh (lookbackDays=30) workflows — the
 * GitHub Actions matrix fans out per-store so each call stays bounded.
 *
 * Writes are upserts; the per-day cleanup is scoped to one (storeId, date)
 * and only drops items that fell out of the source data, so historical rows
 * for other days can never be touched.
 */
export async function POST(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const startedAt = Date.now()
  const url = new URL(request.url)
  const storeId = url.searchParams.get("storeId")
  const lookbackDays = Number(url.searchParams.get("lookbackDays") ?? 7)

  if (!storeId) {
    return NextResponse.json(
      { error: "storeId query param is required" },
      { status: 400 }
    )
  }
  if (!Number.isFinite(lookbackDays) || lookbackDays < 1 || lookbackDays > 365) {
    return NextResponse.json(
      { error: "lookbackDays must be between 1 and 365" },
      { status: 400 }
    )
  }

  const store = await prisma.store.findFirst({
    where: { id: storeId, isActive: true },
    select: { id: true, name: true, accountId: true },
  })
  if (!store) {
    return NextResponse.json(
      { error: `Store ${storeId} not found or inactive` },
      { status: 404 }
    )
  }

  const endDate = new Date()
  endDate.setUTCHours(0, 0, 0, 0)
  const startDate = new Date(endDate)
  startDate.setUTCDate(startDate.getUTCDate() - lookbackDays)

  try {
    const result = await recomputeDailyCogsForRange({
      storeId: store.id,
      accountId: store.accountId,
      startDate,
      endDate,
    })

    return NextResponse.json({
      storeId: store.id,
      storeName: store.name,
      lookbackDays,
      daysProcessed: result.daysProcessed,
      rowsUpserted: result.rowsUpserted,
      rowsDeleted: result.rowsDeleted,
      durationMs: Date.now() - startedAt,
    })
  } catch (err) {
    console.error(`[cron/cogs/sweep] store ${store.id} failed:`, err)
    return NextResponse.json(
      {
        error: "sweep failed",
        message: err instanceof Error ? err.message : String(err),
        storeId: store.id,
        durationMs: Date.now() - startedAt,
      },
      { status: 500 }
    )
  }
}
