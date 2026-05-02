import { NextRequest, NextResponse } from "next/server"
import { isCronRequest } from "@/lib/rate-limit"
import { fetchVercelUsage } from "@/lib/monitoring/vercel-usage"
import { prisma } from "@/lib/prisma"

export const maxDuration = 30

/**
 * Vercel quota poll. Runs every 15 min. Always writes a row, even when
 * the upstream API is unreachable, so the bridge can distinguish
 * "no data yet" from "polling broken".
 */
export async function POST(req: NextRequest) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const { billingCycle, metrics } = await fetchVercelUsage()
  const row = await prisma.vercelUsageSnapshot.create({
    data: { billingCycle, metrics },
    select: { id: true, capturedAt: true },
  })
  return NextResponse.json({ id: row.id, capturedAt: row.capturedAt, billingCycle, metrics })
}

export const GET = POST
