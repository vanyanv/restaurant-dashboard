import "server-only"
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { dangerouslyDeleteByTag, waitUntil } from "@vercel/functions"
import { getRedis } from "@/lib/cache/redis"
import { logger } from "@/lib/logger"

/**
 * How a TV on the version 4 player stays quiet: it reads its playlist from
 * /api/tv/c/<token>, which Vercel's CDN answers from cache, and this module is
 * what makes that safe.
 *
 *  - `tvsChanged` runs after every dashboard save. It clears the account's
 *    cached answers, then tells the TVs over Ably to ask again.
 *  - `cdnSeconds` ends every cached answer at the top of an hour, so a clear
 *    that was missed heals within the hour, and the database is woken once
 *    then, not once per TV.
 *  - The beat (/api/tv/beat/<token>) records "this TV is on" in Redis, never
 *    the database. `beatTicket` is what proves the caller is a paired TV
 *    without a database read: only the cached answer carries it.
 */

/** The CDN tag on every cached answer of one account. Hex and a dash: safe as a Vercel tag. */
export function tvTag(accountId: string): string {
  return `tva-${createHash("sha256").update(`tv-tag:${accountId}`).digest("hex").slice(0, 32)}`
}

/**
 * Seconds a cached answer lives: until the next top of the hour (UTC). With
 * under a minute left it runs to the hour after, so an answer is never cached
 * for a moment only. Always 60 to 3660.
 */
export function cdnSeconds(now: Date = new Date()): number {
  const HOUR = 3_600_000
  const left = Math.ceil((HOUR - (now.getTime() % HOUR)) / 1000)
  return left < 60 ? left + 3600 : left
}

/** The ticket a paired TV sends with its beat. "" when the secret is not set. */
export function beatTicket(tokenHash: string): string {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) return ""
  return createHmac("sha256", secret).update(`tv-beat:${tokenHash}`).digest("hex")
}

export function checkBeatTicket(tokenHash: string, k: unknown): boolean {
  if (typeof k !== "string" || !k) return false
  const want = beatTicket(tokenHash)
  if (!want) return false
  const a = Buffer.from(k)
  const b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** One Ably channel per account, named so it gives nothing away. The publish key is held to `tv:*`. */
export function tvChannel(accountId: string): string {
  const secret = process.env.NEXTAUTH_SECRET ?? ""
  return `tv:${createHash("sha256").update(`tv-channel:${accountId}:${secret}`).digest("hex").slice(0, 32)}`
}

/** Where a TV listens for "changed", or null when push is not set up. The key in it can only subscribe. */
export function pushFor(accountId: string, tokenHash: string): { url: string } | null {
  const key = process.env.ABLY_TV_SUBSCRIBE_KEY
  if (!key) return null
  const q = [
    "v=1.2",
    `channels=${encodeURIComponent(tvChannel(accountId))}`,
    `clientId=${encodeURIComponent(`tv-${tokenHash.slice(0, 16)}`)}`,
    `key=${encodeURIComponent(key)}`,
  ].join("&")
  return { url: `https://realtime.ably.io/sse?${q}` }
}

const PURGE_RETRY_MS = 250
/** A clear that has not answered by now is given up on, so a save never waits on Vercel for long. */
const PURGE_TIMEOUT_MS = 2500
/**
 * A second clear, this long after the first. A TV's request that read the
 * database just before the save can be stored by the CDN just after the first
 * clear; without this it would stay until the top of the hour.
 */
const PURGE_AGAIN_MS = 4000
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** One clear, given up on after PURGE_TIMEOUT_MS. */
async function purgeOnce(tag: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      dangerouslyDeleteByTag(tag),
      new Promise<never>((_, no) => {
        timer = setTimeout(() => no(new Error("timed out")), PURGE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * On Vercel the clear only works inside a request; outside one the package
 * resolves without doing anything. That would leave every TV on its old
 * answer with nothing in the log, so say so.
 */
function purgeIsPossible(): boolean {
  if (!process.env.VERCEL) return true
  try {
    const store = (globalThis as Record<symbol, unknown>)[Symbol.for("@vercel/request-context")] as { get?: () => { purge?: unknown } | undefined } | undefined
    return Boolean(store?.get?.()?.purge)
  } catch {
    return false
  }
}

async function purge(accountId: string): Promise<void> {
  const tag = tvTag(accountId)
  if (!purgeIsPossible()) {
    logger.error("[screens.push] clearing the TV cache is not possible here: no Vercel request context")
    return
  }
  try {
    await purgeOnce(tag)
    return
  } catch {
    await pause(PURGE_RETRY_MS)
  }
  try {
    await purgeOnce(tag)
  } catch (err) {
    logger.error("[screens.push] clearing the TV cache failed", { message: message(err) })
  }
}

/** The second clear, after the answer has gone back to the owner. Never throws. */
function purgeAgainLater(accountId: string): void {
  try {
    waitUntil(
      pause(PURGE_AGAIN_MS)
        .then(() => purge(accountId))
        .catch(() => {}),
    )
  } catch {
    // No request to hang it on (a script, a test): the top of the hour heals it.
  }
}

async function publish(accountId: string): Promise<void> {
  const key = process.env.ABLY_TV_PUBLISH_KEY
  if (!key) return
  try {
    const res = await fetch(`https://rest.ably.io/channels/${encodeURIComponent(tvChannel(accountId))}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(key).toString("base64")}`,
        "Content-Type": "application/json",
        // Ably refuses the publish without one (401, code 40161).
        "X-Ably-ClientId": Buffer.from("dashboard").toString("base64"),
      },
      body: JSON.stringify({ name: "changed", data: "1" }),
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) logger.error("[screens.push] telling the TVs failed", { status: res.status })
  } catch (err) {
    // The name only: a fetch error's message can carry the request, and the request carries the key.
    logger.error("[screens.push] telling the TVs failed", { error: err instanceof Error ? err.name : "unknown" })
  }
}

/**
 * Something a TV shows has changed: clear the account's cached answers, then
 * tell its TVs. In that order, so a TV that asks at once is not handed the old
 * answer. A second clear follows a few seconds later (see PURGE_AGAIN_MS).
 * Never throws, and never waits more than a few seconds: a save that worked
 * stays a save that worked.
 */
export async function tvsChanged(accountId: string): Promise<void> {
  try {
    await purge(accountId)
    await publish(accountId)
    purgeAgainLater(accountId)
  } catch (err) {
    try {
      logger.error("[screens.push] tvsChanged failed", { message: message(err) })
    } catch {}
  }
}

const SEEN_TTL_S = 86_400
const seenKey = (tokenHash: string) => `tv:seen:${tokenHash}`

export type Seen = { at: Date; device: string | null }

/** Note that a TV is on. One Redis command; nothing when Redis is not set up or fails. */
export async function markSeen(tokenHash: string, device: string | null): Promise<void> {
  try {
    const redis = getRedis()
    if (!redis) return
    await redis.set(seenKey(tokenHash), JSON.stringify({ t: Date.now(), d: device }), { ex: SEEN_TTL_S })
  } catch (err) {
    logger.error("[screens.push] noting a TV failed", { message: message(err) })
  }
}

function readSeen(raw: unknown): Seen | null {
  let v = raw
  if (typeof v === "string") {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  if (!v || typeof v !== "object") return null
  const { t, d } = v as { t?: unknown; d?: unknown }
  if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return null
  const at = new Date(t)
  if (Number.isNaN(at.getTime())) return null
  return { at, device: typeof d === "string" && d ? d.slice(0, 120) : null }
}

/** When each TV last said it was on. One MGET for all of them; an empty map when there is nothing to ask or Redis fails. */
export async function seenFor(tokenHashes: string[]): Promise<Map<string, Seen>> {
  const out = new Map<string, Seen>()
  if (tokenHashes.length === 0) return out
  try {
    const redis = getRedis()
    if (!redis) return out
    const rows = await redis.mget<unknown[]>(...tokenHashes.map(seenKey))
    tokenHashes.forEach((h, i) => {
      const seen = readSeen(rows?.[i])
      if (seen) out.set(h, seen)
    })
  } catch (err) {
    logger.error("[screens.push] reading which TVs are on failed", { message: message(err) })
    return new Map()
  }
  return out
}

/**
 * The later of what the database and the beat say, for the dashboard's On / Off.
 * A beat from before the TV was paired is from its last pairing (the Redis note
 * outlives an unpair by a day) and says nothing about this one.
 */
export function latestSeen(dbAt: Date | null, dbDevice: string | null, seen: Seen | undefined, pairedAt?: Date): { at: Date | null; device: string | null } {
  if (!seen || (pairedAt && seen.at < pairedAt)) return { at: dbAt, device: dbDevice }
  return { at: dbAt && dbAt > seen.at ? dbAt : seen.at, device: seen.device ?? dbDevice }
}
