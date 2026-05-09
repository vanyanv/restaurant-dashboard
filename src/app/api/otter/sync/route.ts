import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { revalidatePath } from "next/cache"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { SyncProgressEvent } from "@/types/sync"
import { isCronRequest, rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
import { bustTags } from "@/lib/cache/cached"
import { logger } from "@/lib/logger"
import {
  runMetricsSyncForStore,
  type MetricsSyncResult,
  type ProgressEmitter,
} from "@/lib/otter-metrics-sync"

export const maxDuration = 60

interface SyncResult {
  message: string
  synced: number
  failed: number
  categorySynced: number
  categoryFailed: number
  itemSynced: number
  itemFailed: number
  modifierSynced: number
  modifierFailed: number
  ratingsSynced: number
  ratingsFailed: number
  cogsDaysProcessed: number
  cogsRowsWritten: number
  storesProcessed: number
}

const EMPTY_COUNTS = {
  daily: 0,
  categories: 0,
  items: 0,
  modifiers: 0,
  ratings: 0,
  cogs: 0,
}

async function runSyncAllStores(
  emit: ProgressEmitter,
  triggeredBy: "cron" | "manual",
): Promise<SyncResult> {
  const otterStores = await prisma.otterStore.findMany({
    include: { store: { select: { id: true, name: true, isActive: true } } },
  })

  if (otterStores.length === 0) {
    emit({
      phase: "complete",
      status: "done",
      totalProgress: 100,
      detail: "No Otter stores configured",
      counts: { ...EMPTY_COUNTS },
    })
    return {
      message: "No Otter stores configured",
      synced: 0,
      failed: 0,
      categorySynced: 0,
      categoryFailed: 0,
      itemSynced: 0,
      itemFailed: 0,
      modifierSynced: 0,
      modifierFailed: 0,
      ratingsSynced: 0,
      ratingsFailed: 0,
      cogsDaysProcessed: 0,
      cogsRowsWritten: 0,
      storesProcessed: 0,
    }
  }

  const activeOtterStores = otterStores.filter((os) => os.store.isActive)

  // Group Otter UUIDs by internal storeId (multiple UUIDs may map to one store).
  const storeGroups = new Map<string, string[]>()
  for (const os of activeOtterStores) {
    const uuids = storeGroups.get(os.storeId) ?? []
    uuids.push(os.otterStoreId)
    storeGroups.set(os.storeId, uuids)
  }
  const storeIds = [...storeGroups.keys()]
  const numStores = storeIds.length

  // 3-day rolling window, UTC day boundaries to match downstream API +
  // OtterDailySummary.date (stored at UTC midnight).
  const windowEnd = new Date()
  windowEnd.setUTCHours(23, 59, 59, 999)
  const windowStart = new Date()
  windowStart.setUTCDate(windowStart.getUTCDate() - 3)
  windowStart.setUTCHours(0, 0, 0, 0)

  const aggregateCounts = { ...EMPTY_COUNTS }
  const totals = {
    synced: 0,
    failed: 0,
    categorySynced: 0,
    categoryFailed: 0,
    itemSynced: 0,
    itemFailed: 0,
    modifierSynced: 0,
    modifierFailed: 0,
    ratingsSynced: 0,
    ratingsFailed: 0,
  }

  for (let storeIdx = 0; storeIdx < storeIds.length; storeIdx++) {
    const sid = storeIds[storeIdx]
    const uuids = storeGroups.get(sid) ?? []

    const wrapEmit: ProgressEmitter = (event) => {
      const globalProgress =
        numStores > 0
          ? Math.round((storeIdx * 100 + event.totalProgress) / numStores)
          : 100
      // Show per-store counts on top of running aggregate so the UI sees
      // numbers tick up as stores complete (instead of resetting per store).
      const liveCounts = {
        daily: aggregateCounts.daily + event.counts.daily,
        categories: aggregateCounts.categories + event.counts.categories,
        items: aggregateCounts.items + event.counts.items,
        modifiers: aggregateCounts.modifiers + event.counts.modifiers,
        ratings: aggregateCounts.ratings + event.counts.ratings,
        cogs: aggregateCounts.cogs,
      }
      emit({
        phase: event.phase,
        status: event.status,
        totalProgress: globalProgress,
        detail: event.detail,
        counts: liveCounts,
        error: event.error,
      })
    }

    let result: MetricsSyncResult
    try {
      result = await runMetricsSyncForStore(sid, uuids, windowStart, windowEnd, {
        triggeredBy,
        includeRatings: true,
        onProgress: wrapEmit,
      })
    } catch (err) {
      logger.error(`[otter.metrics.sync] store ${sid} failed:`, err)
      // Don't abort the loop on a single store's failure — continue with the
      // others so one bad store can't lock out the dashboard. Per-store
      // JobRun row already captured the FAILURE inside the runner.
      continue
    }

    totals.synced += result.daily.synced
    totals.failed += result.daily.failed
    totals.categorySynced += result.categories.synced
    totals.categoryFailed += result.categories.failed
    totals.itemSynced += result.items.synced
    totals.itemFailed += result.items.failed
    totals.modifierSynced += result.modifiers.synced
    totals.modifierFailed += result.modifiers.failed
    totals.ratingsSynced += result.ratings.synced
    totals.ratingsFailed += result.ratings.failed

    aggregateCounts.daily += result.daily.synced
    aggregateCounts.categories += result.categories.synced
    aggregateCounts.items += result.items.synced
    aggregateCounts.modifiers += result.modifiers.synced
    aggregateCounts.ratings += result.ratings.synced
  }

  // COGS materialization runs on its own cron schedule — keep the phase
  // event so SSE consumers see the same shape they always have.
  emit({
    phase: "cogs",
    status: "done",
    totalProgress: 100,
    detail: "COGS materialization runs on its own cron schedule",
    counts: { ...aggregateCounts },
  })

  // Fresh Otter data means stale dashboard reads — revalidate the pages
  // that read from DailyCogsItem / OtterDailySummary.
  revalidatePath("/dashboard/menu/catalog")
  revalidatePath("/dashboard/cogs", "layout")
  revalidatePath("/dashboard/pnl", "layout")

  const message = `Otter sync completed: ${totals.synced} daily rows, ${totals.categorySynced} categories, ${totals.itemSynced} items, ${totals.modifierSynced} modifiers, ${totals.ratingsSynced} ratings (${numStores} stores)`

  emit({
    phase: "complete",
    status: "done",
    totalProgress: 100,
    detail: message,
    counts: { ...aggregateCounts },
  })

  // Otter sync runs globally for all owners' active stores. If anything
  // wrote, bust the otter/dash/pnl tags so dashboards reflect the new
  // data on the next page load. Skips when nothing changed.
  if (totals.synced > 0 || totals.itemSynced > 0) {
    await bustTags(["otter", "dash", "pnl"])
  }

  return {
    message,
    synced: totals.synced,
    failed: totals.failed,
    categorySynced: totals.categorySynced,
    categoryFailed: totals.categoryFailed,
    itemSynced: totals.itemSynced,
    itemFailed: totals.itemFailed,
    modifierSynced: totals.modifierSynced,
    modifierFailed: totals.modifierFailed,
    ratingsSynced: totals.ratingsSynced,
    ratingsFailed: totals.ratingsFailed,
    cogsDaysProcessed: 0,
    cogsRowsWritten: 0,
    storesProcessed: numStores,
  }
}

export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.strict)
  if (limited) return limited

  // Allow Vercel Cron or authenticated owner
  const fromCron = isCronRequest(request)
  if (!fromCron) {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (!hasOwnerAccess(session.user.role)) {
      return NextResponse.json({ error: "Only owners can sync Otter data" }, { status: 403 })
    }
  }

  const wantsSSE = request.headers.get("accept")?.includes("text/event-stream")
  const triggeredBy: "cron" | "manual" = fromCron ? "cron" : "manual"

  if (wantsSSE) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const emit: ProgressEmitter = (event) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch {
            // Client disconnected, ignore
          }
        }
        try {
          await runSyncAllStores(emit, triggeredBy)
        } catch (error) {
          logger.error("Otter sync error:", error)
          emit({
            phase: "error",
            status: "error",
            totalProgress: 0,
            detail: error instanceof Error ? error.message : "Internal server error",
            counts: { ...EMPTY_COUNTS },
            error: error instanceof Error ? error.message : "Internal server error",
          })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    })
  }

  // JSON path (cron or non-SSE clients)
  try {
    const result = await runSyncAllStores(() => {}, triggeredBy)
    return NextResponse.json(result)
  } catch (error) {
    logger.error("Otter sync error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    )
  }
}
