import { NextResponse } from "next/server"
import { withCronAuth } from "@/lib/cron-auth"
import { flushCacheStats } from "@/lib/monitoring/cache-stats"

export const maxDuration = 10

/**
 * Flushes the in-process cache-stat counters into the CacheStat table.
 * Intended to run every 10 minutes from GitHub Actions / Vercel cron;
 * the cache layer also opportunistically flushes every N ops, so this
 * is a backstop for low-traffic windows and process restarts.
 */
export const POST = withCronAuth(
  async () => {
    const result = await flushCacheStats()
    return NextResponse.json(result)
  },
  { unauthorized: { status: 403, error: "forbidden" } }
)

// Aliased to GET so it can be hit ad-hoc from the browser/curl during dev.
// Cron platforms (Vercel/GH Actions) use POST.
export const GET = POST
