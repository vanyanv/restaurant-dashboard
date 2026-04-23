import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isCronRequest } from "@/lib/rate-limit"
import { recomputeDailyCogsForRange } from "@/lib/cogs-materializer"

export const maxDuration = 300

/**
 * Force-recompute DailyCogsItem across a rolling lookback window for every
 * active store of every owner. Unlike the stale sweep, this overwrites rows
 * that already exist — catches cost drift when invoices for past dates arrive
 * after the fact and retroactively change what those days' COGS should have
 * been.
 */
export async function POST(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const startedAt = Date.now()
  const url = new URL(request.url)
  const ownerIdParam = url.searchParams.get("ownerId")
  const lookbackDays = Number(url.searchParams.get("lookbackDays") ?? 30)

  const endDate = new Date()
  const startDate = new Date()
  startDate.setUTCDate(startDate.getUTCDate() - lookbackDays)

  const owners = ownerIdParam
    ? await prisma.user.findMany({
        where: { id: ownerIdParam },
        select: { id: true },
      })
    : await prisma.user.findMany({
        where: { ownedStores: { some: { isActive: true } } },
        select: { id: true },
      })

  let storesProcessed = 0
  let daysProcessed = 0
  let rowsWritten = 0
  for (const owner of owners) {
    const stores = await prisma.store.findMany({
      where: { ownerId: owner.id, isActive: true },
      select: { id: true },
    })
    for (const store of stores) {
      try {
        const result = await recomputeDailyCogsForRange({
          storeId: store.id,
          startDate,
          endDate,
          ownerId: owner.id,
        })
        storesProcessed++
        daysProcessed += result.daysProcessed
        rowsWritten += result.rowsWritten
      } catch (err) {
        console.error(
          `[cron/nightly-refresh] store ${store.id} (owner ${owner.id}) failed:`,
          err
        )
      }
    }
  }

  return NextResponse.json({
    ownersProcessed: owners.length,
    storesProcessed,
    daysProcessed,
    rowsWritten,
    durationMs: Date.now() - startedAt,
  })
}
