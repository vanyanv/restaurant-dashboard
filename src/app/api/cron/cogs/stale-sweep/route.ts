import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isCronRequest } from "@/lib/rate-limit"
import { refreshStaleDailyCogs } from "@/lib/cogs-materializer"

export const maxDuration = 300

export async function POST(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const startedAt = Date.now()
  const url = new URL(request.url)
  const ownerIdParam = url.searchParams.get("ownerId")
  const lookbackDays = Number(url.searchParams.get("lookbackDays") ?? 14)

  const owners = ownerIdParam
    ? [{ id: ownerIdParam }]
    : await prisma.user.findMany({
        where: { ownedStores: { some: { isActive: true } } },
        select: { id: true },
      })

  let daysProcessed = 0
  let rowsWritten = 0
  for (const owner of owners) {
    try {
      const result = await refreshStaleDailyCogs({
        ownerId: owner.id,
        lookbackDays,
        concurrency: 4,
      })
      daysProcessed += result.daysProcessed
      rowsWritten += result.rowsWritten
    } catch (err) {
      console.error(`[cron/stale-sweep] owner ${owner.id} failed:`, err)
    }
  }

  return NextResponse.json({
    ownersProcessed: owners.length,
    daysProcessed,
    rowsWritten,
    durationMs: Date.now() - startedAt,
  })
}
