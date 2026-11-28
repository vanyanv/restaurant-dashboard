import { beforeEach, describe, expect, it, vi } from "vitest"

const redis = vi.hoisted(() => ({ client: null as null | { rpush: ReturnType<typeof vi.fn> } }))
const waitUntil = vi.hoisted(() => vi.fn())

vi.mock("@/lib/usage/raw-redis", () => ({ rawRedis: () => redis.client }))
vi.mock("@vercel/functions", () => ({ waitUntil }))

import { count, resetMeterForTest, takePending } from "@/lib/usage/meter"
import { FLUSH_AFTER_MS, flushNow, maybeFlush, PENDING_KEY, resetFlushForTest } from "@/lib/usage/flush"

describe("flush", () => {
  beforeEach(() => {
    resetMeterForTest()
    resetFlushForTest()
    waitUntil.mockReset()
    redis.client = { rpush: vi.fn().mockResolvedValue(1) }
  })

  it("uses the agreed key and interval", () => {
    expect(PENDING_KEY).toBe("usage:pending")
    expect(FLUSH_AFTER_MS).toBe(300_000)
  })

  it("sends everything pending as one RPUSH of one JSON string", async () => {
    count("tv", "calls", 2)
    count("phone", "dbQueries", 5)
    await flushNow()
    expect(redis.client!.rpush).toHaveBeenCalledTimes(1)
    const [key, value] = redis.client!.rpush.mock.calls[0]
    expect(key).toBe(PENDING_KEY)
    expect(typeof value).toBe("string")
    const payload = JSON.parse(value)
    expect(payload.v).toBe(1)
    expect(payload.rows.filter((r: unknown[]) => r[2] === "calls")[0].slice(1)).toEqual(["tv", "calls", 2])
  })

  it("counts its own command, for the next flush", async () => {
    count("tv", "calls")
    await flushNow()
    const next = takePending()
    expect(next?.rows.filter((r) => r[2] === "redisCommands").map((r) => [r[1], r[3]])).toEqual([["other", 1]])
  })

  it("sends nothing when nothing is pending", async () => {
    await flushNow()
    expect(redis.client!.rpush).not.toHaveBeenCalled()
  })

  it("resolves without Redis", async () => {
    redis.client = null
    count("tv", "calls")
    await expect(flushNow()).resolves.toBeUndefined()
  })

  it("resolves and drops the counts when Redis fails", async () => {
    redis.client!.rpush.mockRejectedValue(new Error("down"))
    count("tv", "calls")
    await expect(flushNow()).resolves.toBeUndefined()
    expect(takePending()).toBeNull()
  })

  it("gives up on a Redis that never answers", async () => {
    redis.client!.rpush.mockReturnValue(new Promise(() => {}))
    count("tv", "calls")
    const started = Date.now()
    await flushNow()
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it("does not flush before five minutes", () => {
    count("tv", "calls")
    maybeFlush(Date.now() + FLUSH_AFTER_MS - 1000)
    expect(waitUntil).not.toHaveBeenCalled()
  })

  it("flushes once after five minutes, however often it is asked", () => {
    count("tv", "calls")
    const later = Date.now() + FLUSH_AFTER_MS + 1000
    maybeFlush(later)
    maybeFlush(later)
    maybeFlush(later)
    expect(waitUntil).toHaveBeenCalledTimes(1)
  })

  it("survives waitUntil throwing", () => {
    waitUntil.mockImplementation(() => {
      throw new Error("no request")
    })
    count("tv", "calls")
    expect(() => maybeFlush(Date.now() + FLUSH_AFTER_MS + 1000)).not.toThrow()
  })
})
