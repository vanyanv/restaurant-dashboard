import { NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

// --- Cron request helper (consolidated from 3 duplicated copies) ---

export function isCronRequest(request: Request): boolean {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || !authHeader) return false
  const expected = `Bearer ${cronSecret}`
  if (authHeader.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
}

// --- Rate limiter ---

interface RateLimitConfig {
  limit: number
  windowMs: number
  identifyBy?: "ip" | "user" | "auto"
}

export const RATE_LIMIT_TIERS = {
  /** Sync / external API calls: 2 req/min */
  strict: { limit: 2, windowMs: 60_000 } as RateLimitConfig,
  /** CRUD operations: 30 req/min */
  moderate: { limit: 30, windowMs: 60_000 } as RateLimitConfig,
  /** Auth endpoints: 10 req/min per IP */
  auth: { limit: 10, windowMs: 60_000, identifyBy: "ip" as const } as RateLimitConfig,
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Periodic cleanup of expired entries
let cleanupStarted = false
function ensureCleanup() {
  if (cleanupStarted) return
  cleanupStarted = true
  const interval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (entry.resetAt < now) store.delete(key)
    }
  }, 60_000)
  // Don't keep the process alive just for cleanup
  if (typeof interval === "object" && "unref" in interval) {
    interval.unref()
  }
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  )
}

/**
 * Rate limit a request. Returns null if allowed, or a 429 NextResponse if blocked.
 * Call at the top of route handlers before any business logic.
 */
export async function rateLimit(
  request: Request,
  config: RateLimitConfig
): Promise<NextResponse | null> {
  // Cron requests bypass rate limiting
  if (isCronRequest(request)) return null

  ensureCleanup()

  const pathname = new URL(request.url).pathname
  const identifyBy = config.identifyBy ?? "auto"

  let identity: string
  if (identifyBy === "ip") {
    identity = `ip:${getClientIp(request)}`
  } else if (identifyBy === "user") {
    const session = await getServerSession(authOptions)
    identity = session?.user?.id ? `user:${session.user.id}` : `ip:${getClientIp(request)}`
  } else {
    // "auto": try user first, fall back to IP
    const session = await getServerSession(authOptions)
    identity = session?.user?.id ? `user:${session.user.id}` : `ip:${getClientIp(request)}`
  }

  const key = `${identity}:${pathname}`
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || entry.resetAt < now) {
    // New window
    store.set(key, { count: 1, resetAt: now + config.windowMs })
    return null
  }

  entry.count++

  if (entry.count > config.limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(config.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(entry.resetAt / 1000)),
        },
      }
    )
  }

  return null
}
