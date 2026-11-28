// The charge-first limiter the developer keys unlock uses. Pinned: every
// attempt is counted before it is checked; the window's end is set in the
// same step as the first count; and a Redis that is set up but not answering
// refuses instead of quietly counting in this instance's memory.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }))
vi.mock("@/lib/cache/redis", async (original) => ({
  ...(await original<typeof import("@/lib/cache/redis")>()),
  getRedis: vi.fn(),
}))

import { getRedis } from "@/lib/cache/redis"
import { chargeAttemptKey, clearAttemptKey } from "@/lib/rate-limit"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const LIMIT = { limit: 3, windowMs: 60_000 }
let n = 0
const freshKey = () => `attempt-test:${Date.now()}:${n++}`

/** A stand-in for the Upstash client: one transaction of SET NX PX then INCR. */
function fakeRedis(opts: { failExec?: boolean; failDel?: boolean } = {}) {
  const counts = new Map<string, number>()
  const ttl = new Map<string, number>()
  const calls: string[] = []
  const client = {
    counts,
    ttl,
    calls,
    multi() {
      const steps: Array<() => unknown> = []
      const tx = {
        set(key: string, value: number, o: { nx?: boolean; px?: number }) {
          calls.push(`set ${key} ${value} nx=${o.nx} px=${o.px}`)
          steps.push(() => {
            if (o.nx && counts.has(key)) return null
            counts.set(key, value)
            if (o.px) ttl.set(key, o.px)
            return "OK"
          })
          return tx
        },
        incr(key: string) {
          calls.push(`incr ${key}`)
          steps.push(() => {
            const next = (counts.get(key) ?? 0) + 1
            counts.set(key, next)
            return next
          })
          return tx
        },
        async exec() {
          calls.push("exec")
          if (opts.failExec) throw new Error("Upstash did not answer")
          return steps.map((s) => s())
        },
      }
      return tx
    },
    async del(key: string) {
      calls.push(`del ${key}`)
      if (opts.failDel) throw new Error("Upstash did not answer")
      counts.delete(key)
      ttl.delete(key)
      return 1
    },
    incr: vi.fn(),
    pexpire: vi.fn(),
  }
  return client
}

let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  error = vi.spyOn(console, "error").mockImplementation(() => {})
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "")
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "")
  asMock(getRedis).mockReturnValue(null)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("with no Redis set up (a developer's own computer)", () => {
  it("allows up to the limit, then says over", async () => {
    const key = freshKey()
    const seen: string[] = []
    for (let i = 0; i < 5; i++) seen.push(await chargeAttemptKey(key, LIMIT))
    expect(seen).toEqual(["allowed", "allowed", "allowed", "over", "over"])
  })

  it("counts attempts made at the same moment one by one", async () => {
    const key = freshKey()
    const seen = await Promise.all(Array.from({ length: 20 }, () => chargeAttemptKey(key, LIMIT)))
    expect(seen.filter((s) => s === "allowed")).toHaveLength(3)
  })

  it("starts again from nothing once cleared", async () => {
    const key = freshKey()
    for (let i = 0; i < 4; i++) await chargeAttemptKey(key, LIMIT)
    expect(await chargeAttemptKey(key, LIMIT)).toBe("over")
    await clearAttemptKey(key)
    expect(await chargeAttemptKey(key, LIMIT)).toBe("allowed")
  })
})

describe("with Redis set up", () => {
  beforeEach(() => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.example")
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token")
  })

  it("counts in Redis, and sets the window in the same step as the first count", async () => {
    const redis = fakeRedis()
    asMock(getRedis).mockReturnValue(redis)
    const key = freshKey()
    expect(await chargeAttemptKey(key, LIMIT)).toBe("allowed")
    expect(redis.calls).toEqual([`set rate:${key} 0 nx=true px=60000`, `incr rate:${key}`, "exec"])
    expect(redis.ttl.get(`rate:${key}`)).toBe(60_000)
    // Never the two-step count-then-expire that can leave a key with no end.
    expect(redis.incr).not.toHaveBeenCalled()
    expect(redis.pexpire).not.toHaveBeenCalled()
  })

  it("allows up to the limit, then says over, and clears", async () => {
    const redis = fakeRedis()
    asMock(getRedis).mockReturnValue(redis)
    const key = freshKey()
    const seen: string[] = []
    for (let i = 0; i < 5; i++) seen.push(await chargeAttemptKey(key, LIMIT))
    expect(seen).toEqual(["allowed", "allowed", "allowed", "over", "over"])
    await clearAttemptKey(key)
    expect(redis.counts.has(`rate:${key}`)).toBe(false)
    expect(await chargeAttemptKey(key, LIMIT)).toBe("allowed")
  })

  it("says unavailable when Redis errors, and does not count in memory instead", async () => {
    asMock(getRedis).mockReturnValue(fakeRedis({ failExec: true }))
    const key = freshKey()
    for (let i = 0; i < 6; i++) expect(await chargeAttemptKey(key, LIMIT)).toBe("unavailable")
    expect(error).toHaveBeenCalled()
  })

  it("says unavailable when the client could not be made", async () => {
    asMock(getRedis).mockReturnValue(null)
    expect(await chargeAttemptKey(freshKey(), LIMIT)).toBe("unavailable")
  })

  it("says unavailable when only half of the Redis settings are there", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "")
    asMock(getRedis).mockReturnValue(null)
    expect(await chargeAttemptKey(freshKey(), LIMIT)).toBe("unavailable")
  })

  it("says unavailable for an answer that is not a count", async () => {
    const redis = fakeRedis()
    asMock(getRedis).mockReturnValue({ ...redis, multi: () => ({ set() { return this }, incr() { return this }, exec: async () => ["OK", null] }) })
    expect(await chargeAttemptKey(freshKey(), LIMIT)).toBe("unavailable")
  })

  it("does not throw when clearing fails", async () => {
    asMock(getRedis).mockReturnValue(fakeRedis({ failDel: true }))
    await expect(clearAttemptKey(freshKey())).resolves.toBeUndefined()
  })
})
