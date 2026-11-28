import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * /api/tv/c/<token> against the REAL limiter. The token is in the path, and
 * the limiter that keys on the path would give every made-up token a count of
 * its own (and write the token into Redis). This one counts the address.
 */

const { prisma, redis, redisOn, keys } = vi.hoisted(() => {
  const keys: string[] = []
  const counts = new Map<string, number>()
  const seen = (k: string) => {
    keys.push(k)
    return k
  }
  return {
    keys,
    redisOn: { current: false },
    prisma: { screen: { findUnique: vi.fn(async (_a: unknown) => null), update: vi.fn() }, screenPairing: { create: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() }, $transaction: vi.fn() },
    redis: {
      reset: () => counts.clear(),
      incr: vi.fn(async (k: string) => {
        const n = (counts.get(seen(k)) ?? 0) + 1
        counts.set(k, n)
        return n
      }),
      pexpire: vi.fn(async (k: string, _ms: number) => (seen(k), 1)),
      pttl: vi.fn(async (k: string) => (seen(k), 30_000)),
      get: vi.fn(async (k: string) => (seen(k), null)),
      set: vi.fn(async (k: string, ..._r: unknown[]) => (seen(k), "OK")),
      mget: vi.fn(async (...k: string[]) => (k.forEach(seen), k.map(() => null))),
    },
  }
})
vi.mock("@/lib/prisma", () => ({ prisma }))
vi.mock("@/lib/cache/redis", () => ({ getRedis: () => (redisOn.current ? redis : null) }))
vi.mock("@/lib/session-token", () => ({ readSessionToken: async () => null }))
vi.mock("@vercel/functions", () => ({ dangerouslyDeleteByTag: vi.fn(async () => {}), waitUntil: vi.fn() }))

import { GET } from "@/app/api/tv/c/[token]/route"

let n = 0
/** A new, well-formed token every time: what someone guessing would send. */
const newToken = () => `tok-${String(++n).padStart(8, "0")}-${"x".repeat(32)}`
const tokens: string[] = []
function ask(ip: string, token = newToken()) {
  tokens.push(token)
  return GET(new NextRequest(`https://x.test/api/tv/c/${token}`, { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } }), { params: Promise.resolve({ token }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  keys.length = 0
  tokens.length = 0
  redis.reset()
  redisOn.current = false
})

describe("the limiter on /api/tv/c/<token>", () => {
  it("in memory: 600 different tokens from one address pass, the 601st is refused, and the lookup stops", async () => {
    const ip = "198.51.100.1"
    for (let i = 0; i < 600; i++) expect((await ask(ip)).status).toBe(200)
    expect(prisma.screen.findUnique).toHaveBeenCalledTimes(600)

    const res = await ask(ip)
    expect(res.status).toBe(429)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("retry-after")).not.toBeNull()
    expect((await ask(ip)).status).toBe(429)
    expect(prisma.screen.findUnique).toHaveBeenCalledTimes(600)

    // Another address (another store's TVs) is not held up by it.
    expect((await ask("198.51.100.2")).status).toBe(200)
  })

  it("in memory: the window ends after a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      const ip = "198.51.100.3"
      for (let i = 0; i < 600; i++) await ask(ip)
      expect((await ask(ip)).status).toBe(429)
      vi.setSystemTime(Date.now() + 60_001)
      expect((await ask(ip)).status).toBe(200)
    } finally {
      vi.useRealTimers()
    }
  })

  it("one TV asking again and again counts too, on the same count", async () => {
    const ip = "198.51.100.4"
    const token = newToken()
    for (let i = 0; i < 600; i++) expect((await ask(ip, token)).status).toBe(200)
    expect((await ask(ip, token)).status).toBe(429)
  })

  it("with Redis: one key for the address, the same for every token, and no token in any key", async () => {
    redisOn.current = true
    const ip = "198.51.100.5"
    for (let i = 0; i < 600; i++) expect((await ask(ip)).status).toBe(200)
    expect((await ask(ip)).status).toBe(429)

    expect(new Set(keys)).toEqual(new Set([`rate:tv-c:${ip}`]))
    expect(redis.incr).toHaveBeenCalledTimes(601)
    for (const t of tokens) for (const k of keys) expect(k).not.toContain(t)
    // Nothing else on Redis from this path: no "seen" note, no read.
    expect(redis.set).not.toHaveBeenCalled()
    expect(redis.get).not.toHaveBeenCalled()
    expect(redis.mget).not.toHaveBeenCalled()
  })

  it("something that is not a token is turned away before it is counted", async () => {
    redisOn.current = true
    expect((await ask("198.51.100.6", "short")).status).toBe(404)
    expect(keys).toEqual([])
  })
})
