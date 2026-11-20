// Tag sets expire. A tag set (`tag:<tag>`) used to be SADD'ed on every cache
// write and never expired, so it kept naming keys that had expired long ago
// and grew until something busted the tag. Now each SADD also gives the set an
// expiry no shorter than the key's TTL — and the money property is the other
// direction: the set must never expire before a live key in it, or a later
// bust would miss that key and leave a stale figure on screen.
//
// The fake below models Redis's EXPIRE NX / GT semantics on a fake clock:
// NX applies only to a key with no expiry, GT only when the new expiry is
// later than the current one (and, as in Redis, never to a key with none).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

const values = new Map<string, unknown>()
/** Absolute expiry (ms) per key; absent = no expiry. */
const expiresAt = new Map<string, number>()

function live(k: string): boolean {
  const at = expiresAt.get(k)
  if (at !== undefined && at <= Date.now()) {
    values.delete(k)
    expiresAt.delete(k)
  }
  return values.has(k)
}

function expire(k: string, seconds: number, option?: string): 0 | 1 {
  if (!live(k)) return 0
  const next = Date.now() + seconds * 1000
  const current = expiresAt.get(k)
  const opt = option?.toUpperCase()
  if (opt === "NX" && current !== undefined) return 0
  if (opt === "GT" && (current === undefined || next <= current)) return 0
  expiresAt.set(k, next)
  return 1
}

const fakeRedis = {
  async get(k: string) {
    return live(k) ? values.get(k) : null
  },
  async smembers(k: string) {
    return live(k) ? [...(values.get(k) as Set<string>)] : []
  },
  async del(k: string) {
    values.delete(k)
    expiresAt.delete(k)
    return 1
  },
  pipeline() {
    const ops: Array<() => void> = []
    const p = {
      set(k: string, v: unknown, o?: { ex?: number }) {
        ops.push(() => {
          values.set(k, v)
          if (o?.ex) expiresAt.set(k, Date.now() + o.ex * 1000)
          else expiresAt.delete(k)
        })
        return p
      },
      sadd(k: string, m: string) {
        ops.push(() => {
          const s = live(k) ? (values.get(k) as Set<string>) : new Set<string>()
          s.add(m)
          values.set(k, s)
        })
        return p
      },
      expire(k: string, seconds: number, option?: string) {
        ops.push(() => void expire(k, seconds, option))
        return p
      },
      del(k: string) {
        ops.push(() => {
          values.delete(k)
          expiresAt.delete(k)
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

import { bustTags, cached } from "@/lib/cache/cached"

const ttlOf = (k: string) => {
  const at = expiresAt.get(k)
  return at === undefined ? null : Math.round((at - Date.now()) / 1000)
}
const advance = (seconds: number) => vi.setSystemTime(Date.now() + seconds * 1000)

beforeEach(() => {
  values.clear()
  expiresAt.clear()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-20T18:00:00Z"))
})
afterEach(() => vi.useRealTimers())

describe("tag set expiry", () => {
  it("gives a new tag set the key's TTL", async () => {
    await cached("pnl:a", 300, ["pnl"], async () => ({ v: 1 }))
    expect(ttlOf("tag:pnl")).toBe(300)
  })

  it("extends the set when a longer-lived key joins it", async () => {
    await cached("pnl:a", 300, ["pnl"], async () => ({ v: 1 }))
    await cached("pnl:b", 3600, ["pnl"], async () => ({ v: 2 }))
    expect(ttlOf("tag:pnl")).toBe(3600)
  })

  it("never shortens the set when a shorter-lived key joins it", async () => {
    await cached("pnl:b", 3600, ["pnl"], async () => ({ v: 2 }))
    await cached("pnl:a", 60, ["pnl"], async () => ({ v: 1 }))
    expect(ttlOf("tag:pnl")).toBe(3600)
  })

  it("outlives every key in it, so a later bust still reaches a live key", async () => {
    await cached("pnl:long", 600, ["pnl"], async () => ({ v: "long" }))
    advance(500)
    // A short key joins late; its TTL ends before the long key's. If the set
    // took this TTL, it would expire with `pnl:long` still live.
    await cached("pnl:short", 60, ["pnl"], async () => ({ v: "short" }))
    advance(70)
    expect(await fakeRedis.get("pnl:long")).toEqual({ v: "long" })
    await bustTags(["pnl"])
    expect(await fakeRedis.get("pnl:long")).toBeNull()
  })

  it("gives a set from before this change (no expiry) one on its next write", async () => {
    values.set("tag:pnl", new Set(["pnl:old"]))
    await cached("pnl:a", 300, ["pnl"], async () => ({ v: 1 }))
    expect(ttlOf("tag:pnl")).toBe(300)
  })

  it("goes away with its keys when nobody busts it", async () => {
    await cached("pnl:a", 300, ["pnl"], async () => ({ v: 1 }))
    await cached("pnl:b", 300, ["pnl"], async () => ({ v: 2 }))
    advance(301)
    expect(await fakeRedis.smembers("tag:pnl")).toEqual([])
    expect(values.has("tag:pnl")).toBe(false)
  })

  it("busting deletes every live key in the tag and the set", async () => {
    await cached("pnl:a", 300, ["pnl", "account:1"], async () => ({ v: 1 }))
    await cached("pnl:b", 900, ["pnl"], async () => ({ v: 2 }))
    await bustTags(["pnl"])
    expect(await fakeRedis.get("pnl:a")).toBeNull()
    expect(await fakeRedis.get("pnl:b")).toBeNull()
    expect(values.has("tag:pnl")).toBe(false)
    // The other tag's set still names the key; it simply expires with it.
    expect(ttlOf("tag:account:1")).toBe(300)
  })
})
