import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHmac } from "node:crypto"

const { purge, waitUntil, redis, redisOn, logError } = vi.hoisted(() => ({
  purge: vi.fn((_tag: string | string[], _o?: unknown): Promise<void> => Promise.resolve()),
  waitUntil: vi.fn((_p: Promise<unknown>): void => {}),
  redis: { set: vi.fn(), mget: vi.fn() },
  redisOn: { current: true },
  logError: vi.fn(),
}))
vi.mock("@vercel/functions", () => ({ dangerouslyDeleteByTag: purge, waitUntil }))
vi.mock("@/lib/cache/redis", () => ({ getRedis: () => (redisOn.current ? redis : null) }))
vi.mock("@/lib/logger", () => ({ logger: { error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import {
  beatTicket,
  cdnSeconds,
  checkBeatTicket,
  latestSeen,
  markSeen,
  pushFor,
  seenFor,
  tvChannel,
  tvTag,
  tvsChanged,
} from "@/lib/screens/push"

const HASH = "a".repeat(64)
const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  purge.mockImplementation(async () => {})
  waitUntil.mockImplementation(() => {})
  redisOn.current = true
  vi.stubEnv("VERCEL", "")
  vi.stubEnv("NEXTAUTH_SECRET", "s3cret")
  vi.stubEnv("ABLY_TV_SUBSCRIBE_KEY", "")
  vi.stubEnv("ABLY_TV_PUBLISH_KEY", "")
  fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 201 }))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("cdnSeconds", () => {
  const at = (iso: string) => cdnSeconds(new Date(iso))
  it("runs to the next top of the hour", () => {
    expect(at("2026-11-27T10:00:01.000Z")).toBe(3599)
    expect(at("2026-11-27T10:30:00.000Z")).toBe(1800)
    expect(at("2026-11-27T10:59:00.000Z")).toBe(60)
  })
  it("is a whole hour on the hour itself", () => {
    expect(at("2026-11-27T10:00:00.000Z")).toBe(3600)
  })
  it("runs to the hour after when under a minute is left", () => {
    expect(at("2026-11-27T10:59:00.001Z")).toBe(60)
    expect(at("2026-11-27T10:59:01.000Z")).toBe(3659)
    expect(at("2026-11-27T10:59:59.999Z")).toBe(3601)
  })
  it("stays between 60 and 3660 for every second of an hour", () => {
    const base = Date.parse("2026-11-27T10:00:00.000Z")
    for (let s = 0; s < 3600; s++) {
      const n = cdnSeconds(new Date(base + s * 1000 + 500))
      expect(n).toBeGreaterThanOrEqual(60)
      expect(n).toBeLessThanOrEqual(3660)
      // Every answer ends on an hour, give or take the rounding to a second.
      expect((base + s * 1000 + 500 + n * 1000) % 3_600_000).toBeLessThan(1000)
    }
  })
})

describe("tvTag", () => {
  it("is one tag per account, fit for Vercel", () => {
    expect(tvTag("acc1")).toMatch(/^tva-[0-9a-f]{32}$/)
    expect(tvTag("acc1")).toBe(tvTag("acc1"))
    expect(tvTag("acc1")).not.toBe(tvTag("acc2"))
    expect(tvTag("a,b c")).not.toMatch(/[, ]/)
  })
})

describe("beat ticket", () => {
  it("is the HMAC of the token hash, and checks", () => {
    const k = beatTicket(HASH)
    expect(k).toBe(createHmac("sha256", "s3cret").update(`tv-beat:${HASH}`).digest("hex"))
    expect(checkBeatTicket(HASH, k)).toBe(true)
  })
  it("refuses a changed one, another TV's, a wrong length, and nothing", () => {
    const k = beatTicket(HASH)
    expect(checkBeatTicket(HASH, (k[0] === "0" ? "1" : "0") + k.slice(1))).toBe(false)
    expect(checkBeatTicket("b".repeat(64), k)).toBe(false)
    expect(checkBeatTicket(HASH, k.slice(1))).toBe(false)
    expect(checkBeatTicket(HASH, k + "0")).toBe(false)
    expect(checkBeatTicket(HASH, "é".repeat(64))).toBe(false)
    expect(checkBeatTicket(HASH, "")).toBe(false)
    expect(checkBeatTicket(HASH, null)).toBe(false)
    expect(checkBeatTicket(HASH, undefined)).toBe(false)
  })
  it("never passes, and never throws, with no secret", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "")
    expect(beatTicket(HASH)).toBe("")
    expect(checkBeatTicket(HASH, "")).toBe(false)
    expect(checkBeatTicket(HASH, "anything")).toBe(false)
  })
})

describe("tvChannel and pushFor", () => {
  it("names one opaque tv: channel per account", () => {
    expect(tvChannel("acc1")).toMatch(/^tv:[0-9a-f]{32}$/)
    expect(tvChannel("acc1")).not.toBe(tvChannel("acc2"))
    expect(tvChannel("acc1")).not.toContain("acc1")
    vi.stubEnv("NEXTAUTH_SECRET", "other")
    const other = tvChannel("acc1")
    vi.stubEnv("NEXTAUTH_SECRET", "s3cret")
    expect(other).not.toBe(tvChannel("acc1"))
  })
  it("still names a channel with no secret", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "")
    expect(tvChannel("acc1")).toMatch(/^tv:[0-9a-f]{32}$/)
  })
  it("is null without the subscribe key", () => {
    expect(pushFor("acc1", HASH)).toBeNull()
  })
  it("builds the Ably SSE address, encoded", () => {
    vi.stubEnv("ABLY_TV_SUBSCRIBE_KEY", "app.id:se+cr/et=")
    const { url } = pushFor("acc1", HASH)!
    expect(url).toBe(
      `https://realtime.ably.io/sse?v=1.2&channels=${encodeURIComponent(tvChannel("acc1"))}&clientId=tv-${"a".repeat(16)}&key=app.id%3Ase%2Bcr%2Fet%3D`,
    )
    expect(url).toContain("channels=tv%3A")
    const q = new URL(url).searchParams
    expect(q.get("channels")).toBe(tvChannel("acc1"))
    expect(q.get("key")).toBe("app.id:se+cr/et=")
    expect(q.get("clientId")).toBe(`tv-${HASH.slice(0, 16)}`)
  })
})

describe("tvsChanged", () => {
  const CTX = Symbol.for("@vercel/request-context")
  const g = globalThis as Record<symbol, unknown>
  let ctxBefore: unknown

  beforeEach(() => {
    vi.useFakeTimers()
    ctxBefore = g[CTX]
    delete g[CTX]
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    if (ctxBefore === undefined) delete g[CTX]
    else g[CTX] = ctxBefore
  })

  /** Run it and let `ms` pass. Under four seconds, so the second clear has not come yet. */
  async function run(ms = 600, accountId = "acc1") {
    let done = false
    const p = tvsChanged(accountId).then((v) => {
      done = true
      return v
    })
    await vi.advanceTimersByTimeAsync(ms)
    expect(done).toBe(true)
    return p
  }

  it("off Vercel: clears the cache by the account's tag, with no deadline, and skips Ably without a key", async () => {
    await run()
    expect(purge).toHaveBeenCalledTimes(1)
    expect(purge.mock.calls[0]).toEqual([tvTag("acc1")])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(logError).not.toHaveBeenCalled()
  })

  it("clears first, then publishes", async () => {
    vi.stubEnv("ABLY_TV_PUBLISH_KEY", "app.id:pub")
    let cleared = false
    purge.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20))
      cleared = true
    })
    fetchMock.mockImplementation(async () => {
      expect(cleared).toBe(true)
      return new Response("{}", { status: 201 })
    })
    await run()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(purge.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`https://rest.ably.io/channels/${encodeURIComponent(tvChannel("acc1"))}/messages`)
    expect(init.method).toBe("POST")
    expect(init.headers).toEqual({
      Authorization: `Basic ${Buffer.from("app.id:pub").toString("base64")}`,
      "Content-Type": "application/json",
      "X-Ably-ClientId": Buffer.from("dashboard").toString("base64"),
    })
    expect(JSON.parse(init.body)).toEqual({ name: "changed", data: "1" })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("tries the clear once more, and says nothing when that works", async () => {
    purge.mockRejectedValueOnce(new Error("blip"))
    await run()
    expect(purge).toHaveBeenCalledTimes(2)
    expect(logError).not.toHaveBeenCalled()
  })

  it("gives up the clear after two tries, logs, and still publishes", async () => {
    vi.stubEnv("ABLY_TV_PUBLISH_KEY", "app.id:pub")
    purge.mockRejectedValue(new Error("down"))
    await expect(run()).resolves.toBeUndefined()
    expect(purge).toHaveBeenCalledTimes(2)
    expect(logError).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not throw when the clear throws at once rather than rejecting", async () => {
    purge.mockImplementation(() => {
      throw new Error("no context")
    })
    await expect(run()).resolves.toBeUndefined()
    expect(purge).toHaveBeenCalledTimes(2)
  })

  it("does not throw when Ably is unreachable or refuses, and never logs the key", async () => {
    vi.stubEnv("ABLY_TV_PUBLISH_KEY", "app.id:pubsecret")
    fetchMock.mockRejectedValueOnce(new Error("connect failed for app.id:pubsecret"))
    await expect(run()).resolves.toBeUndefined()
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 401 }))
    await expect(run()).resolves.toBeUndefined()
    expect(logError).toHaveBeenCalledTimes(2)
    const logged = JSON.stringify(logError.mock.calls)
    expect(logged).not.toContain("pubsecret")
    expect(logged).not.toContain(Buffer.from("app.id:pubsecret").toString("base64"))
    expect(logged).toContain("401")
  })

  it("a clear that never answers is given up on: the save waits under six seconds, logs, and still publishes", async () => {
    vi.stubEnv("ABLY_TV_PUBLISH_KEY", "app.id:pub")
    purge.mockImplementation(() => new Promise<void>(() => {}))
    let done = false
    const p = tvsChanged("acc1").then(() => {
      done = true
    })
    // Two tries of 2.5 s with 250 ms between: 5.25 s.
    await vi.advanceTimersByTimeAsync(5200)
    expect(done).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(800)
    expect(done).toBe(true)
    await p
    expect(purge).toHaveBeenCalledTimes(2)
    expect(logError).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logError.mock.calls)).toContain("timed out")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("a clear that answers leaves no timeout behind to fire later", async () => {
    await run(0)
    expect(vi.getTimerCount()).toBe(1) // the second clear only
  })

  describe("on Vercel", () => {
    beforeEach(() => {
      vi.stubEnv("VERCEL", "1")
      vi.stubEnv("ABLY_TV_PUBLISH_KEY", "app.id:pub")
    })

    it.each([
      ["no request context at all", undefined],
      ["a context store that holds nothing", { get: () => undefined }],
      ["a context with no purge", { get: () => ({ waitUntil: () => {} }) }],
      ["a context store that throws", { get: () => { throw new Error("x") } }],
    ])("with %s: says so in the log, does not call the clear, does not throw, and still publishes", async (_n, store) => {
      if (store) g[CTX] = store
      await expect(run()).resolves.toBeUndefined()
      expect(purge).not.toHaveBeenCalled()
      expect(logError).toHaveBeenCalledTimes(1)
      expect(String(logError.mock.calls[0][0])).toContain("no Vercel request context")
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it("with a request context that can purge: clears, and logs nothing", async () => {
      // The shape @vercel/functions reads: globalThis[Symbol.for("@vercel/request-context")].get().purge
      g[CTX] = { get: () => ({ purge: { dangerouslyDeleteByTag: async () => {} } }) }
      await run()
      expect(purge).toHaveBeenCalledTimes(1)
      expect(purge.mock.calls[0]).toEqual([tvTag("acc1")])
      expect(logError).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe("the second clear", () => {
    it("is handed to waitUntil once, after the publish, and fires four seconds later, once", async () => {
      vi.stubEnv("ABLY_TV_PUBLISH_KEY", "app.id:pub")
      await run(0)
      expect(waitUntil).toHaveBeenCalledTimes(1)
      expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise)
      expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(waitUntil.mock.invocationCallOrder[0])
      expect(purge).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(3999)
      expect(purge).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(purge).toHaveBeenCalledTimes(2)
      expect(purge.mock.calls[1]).toEqual([tvTag("acc1")])
      await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined()

      await vi.advanceTimersByTimeAsync(60_000)
      expect(purge).toHaveBeenCalledTimes(2)
      // The TVs are told once; the second clear is quiet.
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(waitUntil).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    })

    it("is one per call, each for its own account", async () => {
      await run(0, "acc1")
      await run(0, "acc2")
      expect(waitUntil).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(4000)
      expect(purge.mock.calls.map((c) => c[0])).toEqual([tvTag("acc1"), tvTag("acc2"), tvTag("acc1"), tvTag("acc2")])
    })

    it("failing does not reject the promise waitUntil holds", async () => {
      await run(0)
      purge.mockRejectedValue(new Error("down"))
      await vi.advanceTimersByTimeAsync(4000 + 250 + 10)
      await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined()
      expect(purge).toHaveBeenCalledTimes(3)
      expect(logError).toHaveBeenCalledTimes(1)
    })

    it("still comes when the first clear failed", async () => {
      purge.mockRejectedValueOnce(new Error("a")).mockRejectedValueOnce(new Error("b"))
      await run()
      expect(waitUntil).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(4000)
      expect(purge).toHaveBeenCalledTimes(3)
    })

    it("waitUntil throwing is harmless: the save is not failed and nothing is logged", async () => {
      waitUntil.mockImplementation(() => {
        throw new Error("no request")
      })
      await expect(run(0)).resolves.toBeUndefined()
      expect(logError).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(logError).not.toHaveBeenCalled()
    })
  })
})

describe("markSeen", () => {
  it("is one SET with a day to live", async () => {
    await markSeen(HASH, "Samsung QN55")
    expect(redis.set).toHaveBeenCalledTimes(1)
    const [key, value, opts] = redis.set.mock.calls[0]
    expect(key).toBe(`tv:seen:${HASH}`)
    expect(opts).toEqual({ ex: 86400 })
    const v = JSON.parse(value)
    expect(v.d).toBe("Samsung QN55")
    expect(Math.abs(v.t - Date.now())).toBeLessThan(5000)
  })
  it("does nothing without Redis, and swallows a Redis failure", async () => {
    redisOn.current = false
    await markSeen(HASH, null)
    expect(redis.set).not.toHaveBeenCalled()
    redisOn.current = true
    redis.set.mockRejectedValueOnce(new Error("down"))
    await expect(markSeen(HASH, null)).resolves.toBeUndefined()
  })
})

describe("seenFor", () => {
  it("asks nothing for no screens, or without Redis", async () => {
    expect((await seenFor([])).size).toBe(0)
    redisOn.current = false
    expect((await seenFor(["h1"])).size).toBe(0)
    expect(redis.mget).not.toHaveBeenCalled()
  })
  it("is one MGET for every screen, reading a string or an object", async () => {
    redis.mget.mockResolvedValue([JSON.stringify({ t: 1_800_000_000_000, d: "TV A" }), { t: 1_800_000_060_000, d: null }, null])
    const m = await seenFor(["h1", "h2", "h3"])
    expect(redis.mget).toHaveBeenCalledTimes(1)
    expect(redis.mget.mock.calls[0]).toEqual(["tv:seen:h1", "tv:seen:h2", "tv:seen:h3"])
    expect(m.get("h1")).toEqual({ at: new Date(1_800_000_000_000), device: "TV A" })
    expect(m.get("h2")).toEqual({ at: new Date(1_800_000_060_000), device: null })
    expect(m.has("h3")).toBe(false)
  })
  it("skips values it cannot read", async () => {
    redis.mget.mockResolvedValue(["not json", { t: "soon" }, 42, { t: Number.NaN }, { t: 8.7e15 }, [], { t: 1_800_000_000_000, d: 7 }])
    const m = await seenFor(["a", "b", "c", "d", "e", "f", "g"])
    expect([...m.keys()]).toEqual(["g"])
    expect(m.get("g")?.device).toBeNull()
  })
  it("is empty when Redis fails", async () => {
    redis.mget.mockRejectedValue(new Error("down"))
    expect((await seenFor(["h1"])).size).toBe(0)
  })
})

describe("latestSeen", () => {
  const early = new Date("2026-11-27T10:00:00Z")
  const late = new Date("2026-11-27T10:05:00Z")
  it("is the database's alone when there was no beat", () => {
    expect(latestSeen(early, "db", undefined)).toEqual({ at: early, device: "db" })
    expect(latestSeen(null, null, undefined)).toEqual({ at: null, device: null })
    expect(latestSeen(early, "db", undefined, late)).toEqual({ at: early, device: "db" })
  })
  it("with no pairing time: takes the later time, and the beat's device when it has one", () => {
    expect(latestSeen(early, "db", { at: late, device: "beat" })).toEqual({ at: late, device: "beat" })
    expect(latestSeen(late, "db", { at: early, device: null })).toEqual({ at: late, device: "db" })
    expect(latestSeen(null, null, { at: early, device: "beat" })).toEqual({ at: early, device: "beat" })
  })
  it("ignores a beat from before the TV was paired: time and device both", () => {
    expect(latestSeen(null, null, { at: early, device: "old owner's tv" }, late)).toEqual({ at: null, device: null })
    expect(latestSeen(null, "db", { at: new Date(late.getTime() - 1), device: "old" }, late)).toEqual({ at: null, device: "db" })
  })
  it("uses a beat from the moment of pairing on", () => {
    expect(latestSeen(null, null, { at: late, device: "beat" }, late)).toEqual({ at: late, device: "beat" })
    expect(latestSeen(null, "db", { at: late, device: null }, early)).toEqual({ at: late, device: "db" })
    expect(latestSeen(early, "db", { at: late, device: "beat" }, early)).toEqual({ at: late, device: "beat" })
  })
})
