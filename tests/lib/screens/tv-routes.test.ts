import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { prisma, redis, rateLimit, rateLimitKey, purge } = vi.hoisted(() => ({
  prisma: {
    screen: { findUnique: vi.fn(), update: vi.fn() },
    screenPairing: { findUnique: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (x: unknown) => x),
  },
  redis: { set: vi.fn(), mget: vi.fn(), get: vi.fn(), incr: vi.fn() },
  rateLimit: vi.fn(async (_r: unknown, _c: unknown): Promise<Response | null> => null),
  rateLimitKey: vi.fn(async (_k: string, _c: unknown): Promise<Response | null> => null),
  purge: vi.fn(async () => {}),
}))
vi.mock("@/lib/prisma", () => ({ prisma }))
vi.mock("@/lib/cache/redis", () => ({ getRedis: () => redis }))
vi.mock("@/lib/rate-limit", () => ({ rateLimit, rateLimitKey, clientIp: () => IP }))
vi.mock("@vercel/functions", () => ({ dangerouslyDeleteByTag: purge, waitUntil: vi.fn() }))

const IP = "203.0.113.7"

import { GET as cached, dynamic as cachedDynamic } from "@/app/api/tv/c/[token]/route"
import { GET as beat, dynamic } from "@/app/api/tv/beat/[token]/route"
import { GET as legacy } from "@/app/api/tv/content/route"
import { contentFor, screenContent } from "@/lib/screens/data"
import { PLAYER_VERSION, hashToken } from "@/lib/screens/core"
import { beatTicket, tvChannel, tvTag } from "@/lib/screens/push"

const TOKEN = "t".repeat(40)
const HASH = hashToken(TOKEN)
const NOW = new Date("2026-11-27T18:20:00.000Z")

const row = (over: object = {}) => ({
  id: "scr1",
  accountId: "acc1",
  name: "Left",
  lastSeenAt: new Date(NOW.getTime() - 5_000),
  device: "Samsung",
  store: { name: "Hollywood" },
  playlist: { name: "Left", slides: [{ id: "sl1", seconds: 10, media: { name: "Burger", blobKey: "acc1/abc.jpg" } }] },
  identifyUntil: null,
  times: [],
  ...over,
})

const ctx = (token: string) => ({ params: Promise.resolve({ token }) })
const getC = (token = TOKEN) => cached(new NextRequest(`https://x.test/api/tv/c/${token}`), ctx(token))
const getBeat = (token: string, q = "") => beat(new NextRequest(`https://x.test/api/tv/beat/${token}${q}`), ctx(token))
const prismaCalls = () =>
  [prisma.screen.findUnique, prisma.screen.update, prisma.screenPairing.findUnique, prisma.screenPairing.deleteMany, prisma.screenPairing.create, prisma.$transaction]
    .map((f) => f.mock.calls.length)
    .reduce((a, b) => a + b, 0)

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] })
  vi.stubEnv("NEXTAUTH_SECRET", "s3cret")
  vi.stubEnv("ABLY_TV_SUBSCRIBE_KEY", "")
  rateLimit.mockResolvedValue(null)
  rateLimitKey.mockResolvedValue(null)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe("GET /api/tv/c/[token]", () => {
  it("always runs when the CDN has no answer: Next never keeps it itself", () => {
    expect(cachedDynamic).toBe("force-dynamic")
  })

  it("is a 404 that is never kept for something that is not a token", async () => {
    const res = await getC("short")
    expect(res.status).toBe(404)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(rateLimit).not.toHaveBeenCalled()
    expect(rateLimitKey).not.toHaveBeenCalled()
    expect(prismaCalls()).toBe(0)
  })

  it("tells a TV that is not paired just that, never kept, and makes no code", async () => {
    prisma.screen.findUnique.mockResolvedValue(null)
    const res = await getC()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ paired: false })
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
    expect(res.headers.get("vercel-cdn-cache-control")).toBeNull()
    expect(res.headers.get("vercel-cache-tag")).toBeNull()
    expect(prisma.screen.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: HASH })
    expect(prisma.screenPairing.findUnique).not.toHaveBeenCalled()
    expect(prisma.screenPairing.create).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("answers a paired TV with what the old endpoint sends, plus beat and push, for the CDN to keep", async () => {
    prisma.screen.findUnique.mockResolvedValue(row())
    const res = await getC()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      paired: true,
      player: PLAYER_VERSION,
      screen: { name: "Left", store: "Hollywood" },
      playlist: { name: "Left", version: expect.any(String), slides: [{ id: "sl1", url: "/api/tv/media/acc1/abc.jpg", seconds: 10, name: "Burger" }] },
      times: [],
      clock: { now: NOW.toISOString(), offsetMinutes: -480 },
      identifyUntil: null,
      beat: beatTicket(HASH),
      push: null,
    })
    expect(body.beat).toMatch(/^[0-9a-f]{64}$/)
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate")
    // 18:20:00 UTC: forty minutes to the hour.
    expect(res.headers.get("vercel-cdn-cache-control")).toBe("public, max-age=2400")
    expect(res.headers.get("vercel-cache-tag")).toBe(tvTag("acc1"))
    // One read, and nothing written.
    expect(prisma.screen.findUnique).toHaveBeenCalledTimes(1)
    expect(prismaCalls()).toBe(1)
  })

  it.each([
    ["on the hour", "2026-11-27T18:00:00.000Z", 3600],
    ["a minute before the hour", "2026-11-27T18:59:00.000Z", 60],
    ["under a minute before the hour", "2026-11-27T18:59:30.000Z", 3630],
    ["just after the hour", "2026-11-27T19:00:00.001Z", 3600],
  ])("keeps the answer to the top of an hour, 60 to 3660 seconds: %s", async (_n, at, want) => {
    vi.setSystemTime(new Date(at))
    prisma.screen.findUnique.mockResolvedValue(row())
    const kept = (await getC()).headers.get("vercel-cdn-cache-control") ?? ""
    const m = /^public, max-age=(\d+)$/.exec(kept)
    expect(m).not.toBeNull()
    const n = Number(m![1])
    expect(n).toBe(want)
    expect(n).toBeGreaterThanOrEqual(60)
    expect(n).toBeLessThanOrEqual(3660)
  })

  it("carries the push address when the subscribe key is set", async () => {
    vi.stubEnv("ABLY_TV_SUBSCRIBE_KEY", "app.id:sub")
    prisma.screen.findUnique.mockResolvedValue(row())
    const { push } = await (await getC()).json()
    const q = new URL(push.url).searchParams
    expect(push.url.startsWith("https://realtime.ably.io/sse?v=1.2&")).toBe(true)
    expect(q.get("channels")).toBe(tvChannel("acc1"))
    expect(q.get("clientId")).toBe(`tv-${HASH.slice(0, 16)}`)
    expect(q.get("key")).toBe("app.id:sub")
  })

  it.each([
    ["was last noted over a minute ago", new Date(NOW.getTime() - 61_000)],
    ["was never noted", null],
  ])("writes nothing to the database, even for a TV that %s", async (_n, lastSeenAt) => {
    prisma.screen.findUnique.mockResolvedValue(row({ lastSeenAt }))
    expect((await getC()).status).toBe(200)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.screen.update).not.toHaveBeenCalled()
    expect(prisma.screenPairing.deleteMany).not.toHaveBeenCalled()
    expect(prismaCalls()).toBe(1)
  })

  it("limits by the address alone, so the token is never in a limiter key, and never keeps a refusal", async () => {
    prisma.screen.findUnique.mockResolvedValue(row())
    await getC()
    expect(rateLimitKey).toHaveBeenCalledTimes(1)
    expect(rateLimitKey.mock.calls[0]).toEqual([`tv-c:${IP}`, { limit: 600, windowMs: 60_000 }])
    expect(JSON.stringify(rateLimitKey.mock.calls)).not.toContain(TOKEN)
    // `rateLimit` adds the path to its key, and the path holds the token.
    expect(rateLimit).not.toHaveBeenCalled()

    rateLimitKey.mockResolvedValueOnce(Response.json({ error: "Too many requests" }, { status: 429 }))
    prisma.screen.findUnique.mockClear()
    const res = await getC()
    expect(res.status).toBe(429)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
    expect(res.headers.get("vercel-cdn-cache-control")).toBeNull()
    expect(prisma.screen.findUnique).not.toHaveBeenCalled()
  })
})

describe("GET /api/tv/beat/[token]", () => {
  it("is never prerendered", () => {
    expect(dynamic).toBe("force-dynamic")
  })

  it("is a 404 for something that is not a token", async () => {
    const res = await getBeat("nope", `?k=${beatTicket(HASH)}`)
    expect(res.status).toBe(404)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(redis.set).not.toHaveBeenCalled()
  })

  it("with the right ticket: the clock, exactly one Redis command, and no database", async () => {
    const res = await getBeat(TOKEN, `?k=${beatTicket(HASH)}&d=${encodeURIComponent("Samsung QN55 " + "x".repeat(200))}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ clock: { now: NOW.toISOString(), offsetMinutes: -480 }, player: PLAYER_VERSION })
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
    expect(redis.set).toHaveBeenCalledTimes(1)
    expect(redis.mget.mock.calls.length + redis.get.mock.calls.length + redis.incr.mock.calls.length).toBe(0)
    const [key, value, opts] = redis.set.mock.calls[0]
    expect(key).toBe(`tv:seen:${HASH}`)
    expect(opts).toEqual({ ex: 86400 })
    const v = JSON.parse(value)
    expect(v.t).toBe(NOW.getTime())
    expect(v.d).toHaveLength(120)
    expect(prismaCalls()).toBe(0)
    expect(rateLimit).not.toHaveBeenCalled()
    expect(rateLimitKey).not.toHaveBeenCalled()
  })

  it("notes no device as null", async () => {
    await getBeat(TOKEN, `?k=${beatTicket(HASH)}`)
    expect(JSON.parse(redis.set.mock.calls[0][1]).d).toBeNull()
  })

  it.each([
    ["no ticket", ""],
    ["a wrong ticket", `?k=${"0".repeat(64)}`],
    ["a short ticket", "?k=abc"],
    ["another TV's ticket", `?k=${beatTicket(hashToken("u".repeat(40)))}`],
  ])("with %s: the clock still, and nothing written anywhere", async (_n, q) => {
    const res = await getBeat(TOKEN, q)
    expect(res.status).toBe(200)
    expect((await res.json()).clock.now).toBe(NOW.toISOString())
    expect(redis.set).not.toHaveBeenCalled()
    expect(prismaCalls()).toBe(0)
  })

  it("writes nothing for any ticket when the secret is not set", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "")
    const res = await getBeat(TOKEN, "?k=")
    expect(res.status).toBe(200)
    expect(redis.set).not.toHaveBeenCalled()
  })

  it("still answers when Redis is down", async () => {
    redis.set.mockRejectedValueOnce(new Error("down"))
    const res = await getBeat(TOKEN, `?k=${beatTicket(HASH)}`)
    expect(res.status).toBe(200)
    expect((await res.json()).player).toBe(PLAYER_VERSION)
  })
})

describe("noting that a TV was seen", () => {
  const stale = () => prisma.screen.findUnique.mockResolvedValue(row({ lastSeenAt: new Date(NOW.getTime() - 61_000) }))

  it("screenContent with note: false reads once and writes nothing, whatever the device", async () => {
    stale()
    const found = await screenContent(HASH, "Other TV", { note: false })
    expect(found?.accountId).toBe("acc1")
    expect(found?.content.paired).toBe(true)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.screen.update).not.toHaveBeenCalled()
    expect(prisma.screenPairing.deleteMany).not.toHaveBeenCalled()
    expect(prismaCalls()).toBe(1)
  })

  it("screenContent notes by default, and when asked to", async () => {
    stale()
    await screenContent(HASH, null)
    await screenContent(HASH, null, {})
    await screenContent(HASH, null, { note: true })
    expect(prisma.$transaction).toHaveBeenCalledTimes(3)
    expect(prisma.screen.update.mock.calls[0][0]).toMatchObject({ where: { id: "scr1" }, data: { lastSeenAt: NOW } })
    expect(prisma.screenPairing.deleteMany.mock.calls[0][0]).toEqual({ where: { tokenHash: HASH } })
  })

  it("screenContent never makes a code for a token it does not know", async () => {
    prisma.screen.findUnique.mockResolvedValue(null)
    expect(await screenContent(HASH, null)).toBeNull()
    expect(await screenContent(HASH, null, { note: false })).toBeNull()
    expect(prisma.screenPairing.findUnique).not.toHaveBeenCalled()
    expect(prisma.screenPairing.create).not.toHaveBeenCalled()
  })

  it("contentFor, the old player's path, still notes", async () => {
    stale()
    await contentFor(HASH, null)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.screen.update.mock.calls[0][0].data).toEqual({ lastSeenAt: NOW })
  })

  it("the old endpoint still notes, with the device the TV sent", async () => {
    stale()
    await legacy(new NextRequest("https://x.test/api/tv/content", { headers: { authorization: `Bearer ${TOKEN}`, "x-screen-device": "Samsung 2" } }))
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.screen.update.mock.calls[0][0].data).toEqual({ lastSeenAt: NOW, device: "Samsung 2" })
  })
})

describe("the old endpoint does not change", () => {
  it("contentFor: a paired TV gets exactly the old fields, no beat and no push", async () => {
    vi.stubEnv("ABLY_TV_SUBSCRIBE_KEY", "app.id:sub")
    prisma.screen.findUnique.mockResolvedValue(row())
    const c = await contentFor(HASH, "Samsung")
    expect(Object.keys(c)).toEqual(["paired", "player", "screen", "playlist", "times", "clock", "identifyUntil"])
    expect(c).not.toHaveProperty("beat")
    expect(c).not.toHaveProperty("push")
    expect(c).not.toHaveProperty("accountId")
  })

  it("contentFor: an unknown token still gets a pairing code made for it", async () => {
    prisma.screen.findUnique.mockResolvedValue(null)
    prisma.screenPairing.findUnique.mockResolvedValue(null)
    const c = await contentFor(HASH, "Samsung")
    expect(c.paired).toBe(false)
    expect(Object.keys(c)).toEqual(["paired", "code", "expiresAt", "player", "qr"])
    expect(prisma.screenPairing.create).toHaveBeenCalledTimes(1)
    expect(prisma.screenPairing.create.mock.calls[0][0].data).toMatchObject({ tokenHash: HASH, device: "Samsung" })
    if (!c.paired) expect(c.code).toMatch(/^[1-9]\d{5}$/)
  })

  it("contentFor: a new device name is still written at once", async () => {
    prisma.screen.findUnique.mockResolvedValue(row())
    await contentFor(HASH, "Other TV")
    expect(prisma.screen.update.mock.calls[0][0].data).toEqual({ lastSeenAt: NOW, device: "Other TV" })
    expect(prisma.screenPairing.deleteMany.mock.calls[0][0]).toEqual({ where: { tokenHash: HASH } })
  })

  it("GET /api/tv/content: Bearer token, both limiters, no-store, no new fields, no CDN headers", async () => {
    prisma.screen.findUnique.mockResolvedValue(row())
    const res = await legacy(
      new NextRequest("https://x.test/api/tv/content", { headers: { authorization: `Bearer ${TOKEN}`, "x-screen-device": "Samsung" } }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body)).toEqual(["paired", "player", "screen", "playlist", "times", "clock", "identifyUntil"])
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("vercel-cdn-cache-control")).toBeNull()
    expect(res.headers.get("vercel-cache-tag")).toBeNull()
    expect(res.headers.get("access-control-allow-headers")).toBe("authorization, x-screen-device")
    expect(rateLimit).toHaveBeenCalledTimes(1)
    expect(rateLimitKey).toHaveBeenCalledTimes(1)
    expect((await legacy(new NextRequest("https://x.test/api/tv/content"))).status).toBe(401)
  })
})
