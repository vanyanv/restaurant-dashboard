import { NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getRedis } from "@/lib/cache/redis"

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

function rateLimitResponse(config: RateLimitConfig, retryAfter: number, resetAt: number) {
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(config.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
      },
    }
  )
}

async function resolveIdentity(
  request: Request,
  identifyBy: RateLimitConfig["identifyBy"]
): Promise<string> {
  if (identifyBy === "ip") return `ip:${getClientIp(request)}`

  const session = await getServerSession(authOptions)
  if (session?.user?.id) return `user:${session.user.id}`

  return `ip:${getClientIp(request)}`
}

async function redisRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<NextResponse | null | undefined> {
  const redis = getRedis()
  if (!redis) return undefined

  const redisKey = `rate:${key}`
  try {
    const count = await redis.incr(redisKey)
    if (count === 1) {
      await redis.pexpire(redisKey, config.windowMs)
    }

    if (count <= config.limit) return null

    const ttlMs = await redis.pttl(redisKey).catch(() => config.windowMs)
    const retryAfter = Math.max(1, Math.ceil(ttlMs / 1000))
    const resetAt = Date.now() + Math.max(ttlMs, 0)
    return rateLimitResponse(config, retryAfter, resetAt)
  } catch (err) {
    console.error("[rate-limit] Redis limiter failed; falling back to in-memory", err)
    return undefined
  }
}

function memoryRateLimit(key: string, config: RateLimitConfig): NextResponse | null {
  ensureCleanup()

  const now = Date.now()
  const entry = store.get(key)

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + config.windowMs })
    return null
  }

  entry.count++

  if (entry.count > config.limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    return rateLimitResponse(config, retryAfter, entry.resetAt)
  }

  return null
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

  const pathname = new URL(request.url).pathname
  const identifyBy = config.identifyBy ?? "auto"
  const identity = await resolveIdentity(request, identifyBy)
  const key = `${identity}:${pathname}`

  const redisResult = await redisRateLimit(key, config)
  if (redisResult !== undefined) return redisResult

  return memoryRateLimit(key, config)
}
