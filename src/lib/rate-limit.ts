import { NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { readSessionToken } from "@/lib/session-token"
import { getRedis, redisWithin } from "@/lib/cache/redis"

// --- Cron request helper (consolidated from 3 duplicated copies) ---

export function isCronRequest(request: Request): boolean {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || !authHeader) return false
  const expected = `Bearer ${cronSecret}`

  // Compare BYTES, not UTF-16 code units. `timingSafeEqual` throws
  // `RangeError` on a length mismatch, so a guard on `String.length` let a
  // same-character-length, longer-encoding header ("Bearer tést-secret")
  // through to it — and an unauthenticated request became a 500 on every
  // cron route instead of a 401.
  const received = Buffer.from(authHeader)
  const want = Buffer.from(expected)
  if (received.length !== want.length) return false
  return timingSafeEqual(received, want)
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
  /**
   * Wrong passwords for one email, from any address: 10 per 15 minutes.
   *
   * The `auth` tier is per IP, so an attacker rotating addresses could try
   * one account's password as fast as they could buy addresses. This counts
   * failures against the (lowercased) email instead. Only failures are
   * charged, so the owner typing the right password is never refused because
   * of someone else's tries; the cost of an attack is that the owner may wait
   * up to 15 minutes after ten wrong tries on their email. 40 guesses an hour
   * against a password of 8+ characters is not a useful rate.
   */
  authEmail: { limit: 10, windowMs: 15 * 60_000 } as RateLimitConfig,
  /**
   * Beacons: 240 req/min.
   *
   * A ceiling against a RUNAWAY CLIENT, not against a reader, and the two need
   * very different numbers. `/api/telemetry/page-view` fires once or twice per
   * navigation, so someone scanning the dashboard at a page every two seconds
   * emits around sixty a minute — twice `moderate`'s whole allowance. Under
   * that tier a normal browsing session started 429ing partway through, and
   * every one of those showed up as a console error on a product page. It was
   * found by walking all fifty gated routes in ninety seconds, which is not
   * even fast.
   *
   * The number has to sit above a person because NOTHING CAN SLOW DOWN IN
   * RESPONSE TO IT. The beacon goes out through `navigator.sendBeacon`, which
   * reports whether the browser queued the request and never what came back;
   * a 429 here is invisible to the code that would have to act on it. So the
   * limiter's job on this path is to stop a loop — four requests a second,
   * sustained, is a loop — and never to pace a human.
   */
  beacon: { limit: 240, windowMs: 60_000 } as RateLimitConfig,
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

  // Who is asking, from the signed session cookie alone: a rate-limit key
  // does not need the database's "is this user still here" check, and that
  // check cost every rate-limited request a user read (the page-view beacon
  // paid it twice, once here and once in the route).
  const token = await readSessionToken()
  if (typeof token?.id === "string") return `user:${token.id}`

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

/**
 * The limiter in this instance's memory only, never Redis. For a path whose
 * whole point is to spend nothing (a TV check-in answered from the Redis cache):
 * it stops one client looping against one instance, which is what it is for.
 */
export function rateLimitLocal(key: string, config: RateLimitConfig): NextResponse | null {
  return memoryRateLimit(key, config)
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
/**
 * The same limiter on a key the caller names, for limits that are not about
 * one client: e.g. every PIN attempt at one store, from any address.
 */
export async function rateLimitKey(key: string, config: RateLimitConfig): Promise<NextResponse | null> {
  const redisResult = await redisRateLimit(key, config)
  if (redisResult !== undefined) return redisResult
  return memoryRateLimit(key, config)
}

/**
 * Is this key already at its limit? Reads the count without adding to it.
 *
 * For limits that charge only FAILURES (a wrong PIN, a wrong password): the
 * route peeks first, refuses if the budget is spent, and charges the key with
 * `rateLimitKey` only when the attempt turns out wrong. A person who gets it
 * right never spends anything, so a stranger's failures cannot be paid for by
 * the crew.
 */
export async function isOverLimitKey(key: string, config: RateLimitConfig): Promise<boolean> {
  const redis = getRedis()
  if (redis) {
    try {
      const count = Number((await redis.get<number | string>(`rate:${key}`)) ?? 0)
      return count >= config.limit
    } catch (err) {
      console.error("[rate-limit] Redis peek failed; falling back to in-memory", err)
    }
  }
  const entry = store.get(key)
  if (!entry || entry.resetAt < Date.now()) return false
  return entry.count >= config.limit
}

/**
 * - `allowed`: counted, and still within the limit.
 * - `over`: counted, and past the limit.
 * - `unavailable`: Redis is set up and did not answer, so nothing was counted.
 */
export type AttemptCharge = "allowed" | "over" | "unavailable"

/** Either Upstash setting present means this deployment is meant to count in Redis. */
function redisIsSetUp(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN)
}

/** How long a Redis count may take before the attempt is refused. */
const ATTEMPT_REDIS_MS = 2_000

/**
 * Count one attempt BEFORE it is checked, and say whether it may go ahead.
 *
 * For a secret that must not be guessable in bulk (the developer keys
 * password). `isOverLimitKey` then `rateLimitKey` reads the count, does the
 * slow check, and only then adds to it, so forty guesses sent at the same
 * moment all read "under the limit" and all get checked. Here every attempt
 * takes its own number first; the caller clears the count with
 * `clearAttemptKey` when the attempt turns out right.
 *
 * Two things differ from `rateLimitKey`, on purpose, and only here:
 *
 * - The window's end is set in the same transaction as the first count
 *   (`SET key 0 NX PX` then `INCR`, inside `MULTI`), so a count can never be
 *   left with no end because a second call failed.
 * - When Redis is set up but does not answer, the answer is `unavailable` and
 *   the caller refuses. Falling back to this instance's memory would give
 *   every server instance its own fresh budget. With no Redis set up at all
 *   (a developer's own computer) there is one instance, and memory is right.
 */
export async function chargeAttemptKey(key: string, config: RateLimitConfig): Promise<AttemptCharge> {
  if (!redisIsSetUp()) return memoryRateLimit(key, config) === null ? "allowed" : "over"

  try {
    const redis = getRedis()
    if (!redis) return "unavailable"
    const redisKey = `rate:${key}`
    const answer = await redisWithin(
      redis.multi().set(redisKey, 0, { nx: true, px: config.windowMs }).incr(redisKey).exec(),
      ATTEMPT_REDIS_MS,
    )
    const count: unknown = Array.isArray(answer) ? answer[1] : undefined
    if (typeof count !== "number" || !Number.isFinite(count) || count < 1) return "unavailable"
    return count <= config.limit ? "allowed" : "over"
  } catch (err) {
    console.error("[rate-limit] Redis attempt count failed; refusing the attempt", err)
    return "unavailable"
  }
}

/** Forget the attempts counted on a key by `chargeAttemptKey`. Never throws. */
export async function clearAttemptKey(key: string): Promise<void> {
  if (!redisIsSetUp()) {
    store.delete(key)
    return
  }
  try {
    await redisWithin(Promise.resolve(getRedis()?.del(`rate:${key}`)), ATTEMPT_REDIS_MS)
  } catch (err) {
    console.error("[rate-limit] Redis attempt reset failed; the count runs out on its own", err)
  }
}

/** The client address the limiter keys on, for callers composing their own keys. */
export function clientIp(request: Request): string {
  return getClientIp(request)
}

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
