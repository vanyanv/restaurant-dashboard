import { beforeEach, describe, expect, it, vi } from "vitest"

const { store, redis, screenRow, prisma } = vi.hoisted(() => {
// A Redis that keeps values in a Map, with expiry, the way Upstash hands JSON back.
const store = new Map<string, { v: unknown; until: number }>()
const redis = {
  on: true,
  fail: false,
  check() {
    if (this.fail) throw new Error("redis down")
  },
  live(k: string) {
    const e = store.get(k)
    if (!e) return null
    if (e.until <= Date.now()) {
      store.delete(k)
      return null
    }
    return structuredClone(e.v)
  },
  slow: false,
  calls: 0,
  async mget(...keys: string[]) {
    this.calls++
    this.check()
    if (this.slow) await new Promise((r) => setTimeout(r, 5_000))
    return keys.map((k) => this.live(k))
  },
  async set(k: string, v: unknown, o?: { ex?: number }) {
    this.calls++
    this.check()
    store.set(k, { v: structuredClone(v), until: o?.ex ? Date.now() + o.ex * 1000 : Infinity })
    return "OK"
  },
  async del(...keys: string[]) {
    for (const k of keys) store.delete(k)
    return keys.length
  },
  pipeline() {
    const ops: string[] = []
    const p = {
      incr: (k: string) => (ops.push(k), p),
      exec: async () => {
        redis.check()
        return ops.map((k) => {
          const n = Number(redis.live(k) ?? 0) + 1
          store.set(k, { v: n, until: Infinity })
          return n
        })
      },
    }
    return p
  },
}
const screenRow = {
  id: "s1",
  name: "Left",
  lastSeenAt: null as Date | null,
  device: "Tizen 7.0",
  store: { name: "Main St" },
  playlist: { name: "Menu", slides: [{ id: "sl1", seconds: 10, media: { name: "a.png", blobKey: "screens/x/11111111-1111-1111-1111-111111111111.png" } }] },
  identifyUntil: null as Date | null,
  times: [],
}
const prisma = {
  screen: {
    findUnique: vi.fn(async () => structuredClone(screenRow) as typeof screenRow | null),
    update: vi.fn(async () => ({ id: "s1" })),
    findMany: vi.fn(async () => [{ tokenHash: "h1" }]),
  },
  screenPairing: {
    findUnique: vi.fn(async () => null as null | { code: string; expiresAt: Date }),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    create: vi.fn(async () => ({})),
  },
  screenEvent: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})) },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
}
return { store, redis, screenRow, prisma }
})
vi.mock("@/lib/cache/redis", async (orig) => ({
  ...(await orig<typeof import("@/lib/cache/redis")>()),
  getRedis: () => (redis.on ? redis : null),
}))
vi.mock("@/lib/prisma", () => ({ prisma }))

import { contentFor } from "@/lib/screens/data"
import { forgetTvs, seenAt } from "@/lib/screens/tv-cache"
import { pingAccountTvs, pingTvs, tvChannel } from "@/lib/screens/push"
import { ONLINE_WINDOW_MS, SEEN_NOTE_EVERY_MS, TV_PUSHED_POLL_MS } from "@/lib/screens/limits"

const dbReads = () => prisma.screen.findUnique.mock.calls.length

beforeEach(() => {
  store.clear()
  redis.on = true
  redis.fail = false
  redis.slow = false
  redis.calls = 0
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe("TV check-in without the database", () => {
  it("reads the database once, then answers from Redis until something changes", async () => {
    const first = await contentFor("h1", "Tizen 7.0")
    const second = await contentFor("h1", "Tizen 7.0")
    expect(dbReads()).toBe(1)
    expect(second).toEqual({ ...first, clock: expect.any(Object) })

    await pingTvs(["h1"])
    await contentFor("h1", "Tizen 7.0")
    expect(dbReads()).toBe(2)
  })

  it("serves a fresh clock, and drops an identify that has run out, from the saved answer", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-26T20:00:00Z"), toFake: ["Date"] })
    prisma.screen.findUnique.mockResolvedValueOnce({ ...structuredClone(screenRow), identifyUntil: new Date("2026-11-26T20:01:00Z") })
    const a = await contentFor("h1", null)
    expect(a.paired && a.identifyUntil).toBe("2026-11-26T20:01:00.000Z")

    vi.setSystemTime(new Date("2026-11-26T20:05:00Z"))
    const b = await contentFor("h1", null)
    expect(dbReads()).toBe(1)
    expect(b.paired && b.clock.now).toBe("2026-11-26T20:05:00.000Z")
    expect(b.paired && b.identifyUntil).toBeNull()
  })

  it("does not keep an answer read while a change was being saved", async () => {
    // The change lands between the counter read and the database read.
    prisma.screen.findUnique.mockImplementationOnce(async () => {
      await forgetTvs(["h1"])
      return structuredClone(screenRow)
    })
    await contentFor("h1", null)
    await contentFor("h1", null)
    expect(dbReads()).toBe(2)
    await contentFor("h1", null)
    expect(dbReads()).toBe(2)
  })

  it("reads again when the TV describes itself differently, so the new name is saved", async () => {
    await contentFor("h1", "Tizen 7.0")
    await contentFor("h1", "Tizen 7.0 · 3840x2160")
    expect(dbReads()).toBe(2)
    await contentFor("h1", null)
    expect(dbReads()).toBe(2)
  })

  it("keeps a pairing code only until it runs out, and forgets it when the TV is claimed", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-26T20:00:00Z"), toFake: ["Date"] })
    prisma.screen.findUnique.mockResolvedValue(null)
    const a = await contentFor("h2", null)
    expect(a.paired).toBe(false)
    await contentFor("h2", null)
    expect(dbReads()).toBe(1)

    vi.setSystemTime(new Date("2026-11-26T20:10:01Z"))
    await contentFor("h2", null)
    expect(dbReads()).toBe(2)

    prisma.screen.findMany.mockResolvedValueOnce([{ tokenHash: "h2" }])
    await pingAccountTvs("acc1")
    prisma.screen.findUnique.mockResolvedValue(structuredClone(screenRow))
    const claimed = await contentFor("h2", null)
    expect(claimed.paired).toBe(true)
  })

  it("notes each check-in in Redis, for the dashboard's On and Off", async () => {
    await contentFor("h1", null)
    await contentFor("h1", null)
    const seen = await seenAt(["h1", "nobody"])
    expect(Date.now() - seen.get("h1")!.getTime()).toBeLessThan(5_000)
    expect(seen.has("nobody")).toBe(false)
  })

  it("goes to the database every time when Redis is missing or failing, and never throws", async () => {
    redis.on = false
    await contentFor("h1", null)
    await contentFor("h1", null)
    expect(dbReads()).toBe(2)

    redis.on = true
    redis.fail = true
    await contentFor("h1", null)
    await expect(pingTvs(["h1"])).resolves.toBeUndefined()
    expect(await seenAt(["h1"])).toEqual(new Map())
    expect(dbReads()).toBe(3)
  })

  it("does not wait on a slow Redis: the check-in goes to the database", async () => {
    redis.slow = true
    const t = Date.now()
    const c = await contentFor("h1", null)
    expect(c.paired).toBe(true)
    expect(Date.now() - t).toBeLessThan(2_000)
    expect(dbReads()).toBe(1)
  })

  it("costs one Redis command per check-in answered from Redis, plus a seen note every 90 s", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-26T20:00:00Z"), toFake: ["Date"] })
    await contentFor("h1", null) // from the database: read, save, note
    redis.calls = 0
    vi.setSystemTime(new Date("2026-11-26T20:01:00Z"))
    await contentFor("h1", null)
    expect(redis.calls).toBe(1)
    vi.setSystemTime(new Date("2026-11-26T20:02:00Z"))
    await contentFor("h1", null)
    expect(redis.calls).toBe(3) // 120 s since the note: read + note
    const seen = await seenAt(["h1"])
    expect(seen.get("h1")?.toISOString()).toBe("2026-11-26T20:02:00.000Z")
  })

  it("keeps a live TV On although it notes itself only every 90 s", () => {
    // Worst case: the note is one interval plus one check-in old, and one more check-in is lost.
    expect(SEEN_NOTE_EVERY_MS + 2 * TV_PUSHED_POLL_MS).toBeLessThanOrEqual(ONLINE_WINDOW_MS)
  })

  it("writes no check-in time for a TV whose Pusher socket is open, and does for one without", async () => {
    vi.stubEnv("PUSHER_APP_ID", "3")
    vi.stubEnv("PUSHER_KEY", "k")
    vi.stubEnv("PUSHER_SECRET", "s")
    vi.stubEnv("PUSHER_CLUSTER", "us3")
    try {
      const occupied = { value: true }
      const f = vi.fn(async (url: string) => {
        expect(url).toContain(`/apps/3/channels/${tvChannel("h1")}?`)
        return new Response(JSON.stringify({ occupied: occupied.value }), { status: 200 })
      })
      vi.stubGlobal("fetch", f)
      vi.useFakeTimers({ now: new Date("2026-11-26T20:00:00Z"), toFake: ["Date"] })
      await contentFor("h1", null) // from the database: notes seen, as every database read does
      vi.setSystemTime(new Date("2026-11-26T20:02:00Z"))
      redis.calls = 0
      await contentFor("h1", null)
      expect(f).toHaveBeenCalledTimes(1)
      expect(redis.calls).toBe(1) // the read only
      occupied.value = false
      vi.setSystemTime(new Date("2026-11-26T20:03:00Z"))
      redis.calls = 0
      await contentFor("h1", null)
      expect(redis.calls).toBe(2) // read + note
    } finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  })
})
