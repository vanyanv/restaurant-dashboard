import { NextRequest, NextResponse } from "next/server"
import { isCronRequest } from "@/lib/rate-limit"
import { flushCacheStats } from "@/lib/monitoring/cache-stats"

export const maxDuration = 10

/**
 * Flushes the in-process cache-stat counters into the CacheStat table.
 * Intended to run every 10 minutes from GitHub Actions / Vercel cron;
 * the cache layer also opportunistically flushes every N ops, so this
 * is a backstop for low-traffic windows and process restarts.
 */
export async function POST(req: NextRequest) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const result = await flushCacheStats()
  return NextResponse.json(result)
}

export const GET = POST
