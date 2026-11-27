import { createHash, createHmac } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { getRedis } from "@/lib/cache/redis"
import { forgetTvs } from "./tv-cache"

/**
 * Tells TVs the moment something they show changes, so they don't wait for
 * their next check. Pusher Channels (free plan) holds one socket per TV; the
 * dashboard sends one small "change" ping and each TV then asks
 * /api/tv/content as usual. The ping carries nothing: what to show still
 * comes only from that call, with the TV's token.
 *
 * Off when the four PUSHER_* variables are unset: TVs then keep checking
 * every 30 seconds, as before.
 */

type PushConfig = { appId: string; key: string; secret: string; cluster: string }

export function pushConfig(): PushConfig | null {
  const appId = process.env.PUSHER_APP_ID?.trim()
  const key = process.env.PUSHER_KEY?.trim()
  const secret = process.env.PUSHER_SECRET?.trim()
  const cluster = process.env.PUSHER_CLUSTER?.trim()
  if (!appId || !key || !secret || !cluster || !/^[a-z0-9-]+$/.test(cluster)) return null
  return { appId, key, secret, cluster }
}

/**
 * One channel per TV, named from its token hash. Without the TV's token the
 * name can't be worked out, and listening in would only show that something
 * changed.
 */
export function tvChannel(tokenHash: string): string {
  return "tv-" + createHash("sha256").update("screens-push:" + tokenHash).digest("hex").slice(0, 40)
}

/** What the TV needs to listen, or null when push is off. */
export function tvPush(tokenHash: string): { key: string; cluster: string; channel: string } | null {
  const c = pushConfig()
  return c ? { key: c.key, cluster: c.cluster, channel: tvChannel(tokenHash) } : null
}

/** Pusher's REST signature: HMAC-SHA256 of method, path and sorted query. */
export function signedEventsUrl(c: PushConfig, body: string, now = Date.now()): string {
  const path = `/apps/${c.appId}/events`
  const query =
    `auth_key=${encodeURIComponent(c.key)}` +
    `&auth_timestamp=${Math.floor(now / 1000)}` +
    `&auth_version=1.0` +
    `&body_md5=${createHash("md5").update(body).digest("hex")}`
  const signature = createHmac("sha256", c.secret).update(`POST\n${path}\n${query}`).digest("hex")
  return `https://api-${c.cluster}.pusher.com${path}?${query}&auth_signature=${signature}`
}

/**
 * These TVs' content changed: drop their saved answers (tv-cache.ts), then
 * ping them. Call after the change is saved. Never throws and gives up after
 * 3 seconds: a missed ping only means the TV finds the change on its next check.
 */
export async function pingTvs(tokenHashes: string[]): Promise<void> {
  await forgetTvs(tokenHashes)
  const c = pushConfig()
  if (!c || tokenHashes.length === 0) return
  const channels = [...new Set(tokenHashes.map(tvChannel))]
  try {
    // Pusher takes up to 100 channels per event.
    for (let i = 0; i < channels.length; i += 100) {
      const body = JSON.stringify({ name: "change", channels: channels.slice(i, i + 100), data: "{}" })
      const res = await fetch(signedEventsUrl(c, body), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) logger.warn("[screens.push] Pusher refused the ping", { status: res.status })
    }
  } catch (err) {
    logger.warn("[screens.push] ping failed", { message: err instanceof Error ? err.message : String(err) })
  }
}

/** Ping every TV in the account. */
export async function pingAccountTvs(accountId: string): Promise<void> {
  if (!pushConfig() && !getRedis()) return
  try {
    const screens = await prisma.screen.findMany({ where: { accountId }, select: { tokenHash: true } })
    await pingTvs(screens.map((s) => s.tokenHash))
  } catch (err) {
    logger.warn("[screens.push] could not list screens", { message: err instanceof Error ? err.message : String(err) })
  }
}
