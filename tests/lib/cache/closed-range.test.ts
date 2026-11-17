// Saved past-day figures: the money property is that a write which changes a
// closed day's figure is never followed by the old figure. Everything else
// (how long a figure lives, how few INCRs a sync costs) is the speed half.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

const store = new Map<string, unknown>()
const ttls = new Map<string, number>()
let incrCalls = 0
const fakeRedis = {
  async get(k: string) {
    return store.has(k) ? store.get(k) : null
  },
  async mget(...keys: string[]) {
    return keys.map((k) => (store.has(k) ? store.get(k) : null))
  },
  async incr(k: string) {
    incrCalls++
    const n = Number(store.get(k) ?? 0) + 1
    store.set(k, n)
    return n
  },
  pipeline() {
    const ops: Array<() => void> = []
    const p = {
      set(k: string, v: unknown, o?: { ex?: number }) {
        ops.push(() => {
          store.set(k, v)
          if (o?.ex) ttls.set(k, o.ex)
        })
        return p
      },
      incr(k: string) {
        ops.push(() => {
          incrCalls++
          store.set(k, Number(store.get(k) ?? 0) + 1)
        })
        return p
      },
      expire() {
        return p
      },
      sadd(k: string, m: string) {
        ops.push(() => {
          const s = (store.get(k) as Set<string>) ?? new Set<string>()
          s.add(m)
          store.set(k, s)
        })
        return p
      },
      async exec() {
        ops.forEach((f) => f())
        return []
      },
    }
    return p
  },
}
vi.mock("@/lib/cache/redis", () => ({ getRedis: () => fakeRedis }))
vi.mock("@/lib/monitoring/cache-stats", () => ({
  bumpHit: () => {},
  bumpMiss: () => {},
  bumpWrite: () => {},
  bumpBust: () => {},
  bumpFailure: () => {},
  prefixOf: (k: string) => k.split(":")[0],
}))
vi.mock("@/lib/monitoring/errors", () => ({ recordError: async () => {} }))

import { cached } from "@/lib/cache/cached"
import { otterRangeTags, rangeTtl } from "@/lib/cache/range"
import {
  CLOSED_RANGE_TTL,
  bumpClosedGeneration,
  bumpDays,
  isClosedRange,
  isFigureWrite,
  laDatesBetween,
  parseClosedMarker,
  rangeScopedTags,
  withScopedWrites,
} from "@/lib/cache/closed-range"

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`)

beforeEach(() => {
  store.clear()
  ttls.clear()
  incrCalls = 0
  vi.useFakeTimers({ toFake: ["Date"] })
  // 10:00 in Los Angeles on Mon 2026-11-16.
  vi.setSystemTime(new Date("2026-11-16T18:00:00Z"))
})
afterEach(() => vi.useRealTimers())

describe("isClosedRange", () => {
  it("closes any range that ends before today in LA", () => {
    expect(isClosedRange(utc("2026-11-15"))).toBe(true)
    expect(isClosedRange(utc("2026-11-01"))).toBe(true)
    expect(isClosedRange(utc("2026-11-16"))).toBe(false)
  })

  it("never closes an unparseable date", () => {
    expect(isClosedRange(new Date("nope"))).toBe(false)
  })

  it("uses the LA date, not the UTC one, for today", () => {
    // 23:30 LA on the 16th is already the 17th in UTC.
    vi.setSystemTime(new Date("2026-11-17T07:30:00Z"))
    expect(isClosedRange(utc("2026-11-16"))).toBe(false)
    expect(isClosedRange(utc("2026-11-15"))).toBe(true)
  })
})

describe("range tags", () => {
  it("gives a past range only the marker, carrying its days", () => {
    const tags = otterRangeTags(utc("2026-11-09"), utc("2026-11-15"))
    expect(tags).toHaveLength(1)
    expect(parseClosedMarker(tags[0])).toEqual({ from: "2026-11-09", to: "2026-11-15" })
  })

  it("leaves a range that includes today on the broad and month tags", () => {
    expect(otterRangeTags(utc("2026-11-10"), utc("2026-11-16"))).toEqual([
      "otter",
      "dash",
      "pnl:m:2026-11",
    ])
  })

  it("does not save a range longer than 400 days", () => {
    expect(rangeScopedTags(utc("2024-01-01"), utc("2026-11-15"), ["x"])).toEqual(["x"])
  })

  it("ignores tags that only look like markers", () => {
    expect(parseClosedMarker("otter")).toBeNull()
    expect(parseClosedMarker("__closed-range__:nope")).toBeNull()
  })
})

describe("cached() with a closed range", () => {
  const lastWeek = () => otterRangeTags(utc("2026-11-09"), utc("2026-11-15"))

  it("saves the figure for the long TTL, with no tag sets", async () => {
    const loader = vi.fn(async () => ({ sales: 100 }))
    await cached("counter:x", rangeTtl(utc("2026-11-15")), lastWeek(), loader)
    await cached("counter:x", rangeTtl(utc("2026-11-15")), lastWeek(), loader)
    expect(loader).toHaveBeenCalledTimes(1)
    const saved = [...ttls.entries()].find(([k]) => k.startsWith("counter:x:cv"))
    expect(saved?.[1]).toBe(CLOSED_RANGE_TTL)
    expect([...store.keys()].some((k) => k.startsWith("tag:"))).toBe(false)
  })

  it("refetches after any undated figure write", async () => {
    let sales = 100
    const loader = vi.fn(async () => ({ sales }))
    expect(await cached("counter:x", 300, lastWeek(), loader)).toEqual({ sales: 100 })
    sales = 120
    await bumpClosedGeneration()
    expect(await cached("counter:x", 300, lastWeek(), loader)).toEqual({ sales: 120 })
  })

  it("refetches after a dated write to a day inside the range", async () => {
    let sales = 100
    const loader = vi.fn(async () => ({ sales }))
    await cached("counter:x", 300, lastWeek(), loader)
    sales = 130
    await bumpDays(["2026-11-12"])
    expect(await cached("counter:x", 300, lastWeek(), loader)).toEqual({ sales: 130 })
  })

  it("keeps the figure when a dated write touches only other days", async () => {
    const loader = vi.fn(async () => ({ sales: 100 }))
    await cached("counter:x", 300, lastWeek(), loader)
    // What the hourly sync writes on Monday the 16th.
    await bumpDays(["2026-11-16", "2026-11-17"])
    await cached("counter:x", 300, lastWeek(), loader)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it("does not touch an open range's key, TTL or tags", async () => {
    const tags = otterRangeTags(utc("2026-11-10"), utc("2026-11-16"))
    await cached("counter:x:open", 60, tags, async () => 1)
    expect(ttls.get("counter:x:open")).toBe(60)
    expect(store.has("tag:otter")).toBe(true)
  })
})

describe("withScopedWrites", () => {
  it("retires exactly the days it wrote, not the global generation", async () => {
    await withScopedWrites(() => ["2026-11-15", "2026-11-16"], async () => {})
    expect(store.get("cache:dv:2026-11-15")).toBe(1)
    expect(store.get("cache:dv:2026-11-16")).toBe(1)
    expect(store.has("cache:closed-gen")).toBe(false)
  })

  it("still retires its days when the writer fails halfway", async () => {
    await expect(
      withScopedWrites(
        () => ["2026-11-01"],
        async () => {
          throw new Error("boom")
        },
      ),
    ).rejects.toThrow("boom")
    expect(store.get("cache:dv:2026-11-01")).toBe(1)
  })

  it("falls back to the global bump when it cannot say what it wrote", async () => {
    await withScopedWrites(
      () => {
        throw new Error("unknown")
      },
      async () => {},
    )
    expect(store.get("cache:closed-gen")).toBe(1)
  })

  it("laDatesBetween is inclusive and crosses months", () => {
    expect(laDatesBetween("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ])
  })
})

describe("bump coalescing", () => {
  it("shares a bump that has not started and never skips one after a write", async () => {
    await Promise.all(Array.from({ length: 50 }, () => bumpClosedGeneration()))
    expect(incrCalls).toBeGreaterThanOrEqual(1)
    expect(incrCalls).toBeLessThanOrEqual(2)
    const before = incrCalls
    await bumpClosedGeneration()
    expect(incrCalls).toBe(before + 1)
  })
})

describe("isFigureWrite", () => {
  it("counts writes to models that feed saved figures", () => {
    expect(isFigureWrite("OtterOrder", "upsert")).toBe(true)
    expect(isFigureWrite("Store", "update")).toBe(true)
    expect(isFigureWrite("HarriDailyLabor", "createMany")).toBe(true)
  })

  it("counts raw writes, which name no model", () => {
    expect(isFigureWrite(undefined, "$executeRaw")).toBe(true)
  })

  it("ignores reads and writes that cannot move a figure", () => {
    expect(isFigureWrite("OtterOrder", "findMany")).toBe(false)
    expect(isFigureWrite(undefined, "$queryRaw")).toBe(false)
    expect(isFigureWrite("PageView", "create")).toBe(false)
    expect(isFigureWrite("CheckMark", "upsert")).toBe(false)
    expect(isFigureWrite("CacheStat", "upsert")).toBe(false)
  })
})
