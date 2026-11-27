import { beforeEach, describe, expect, it, vi } from "vitest"

const redis = vi.hoisted(() => {
  const store = new Map<string, unknown>()
  return {
    store,
    fail: false,
    async get(k: string) {
      if (this.fail) throw new Error("down")
      return store.get(k) ?? null
    },
    async set(k: string, v: unknown) {
      if (this.fail) throw new Error("down")
      store.set(k, v)
      return "OK"
    },
    async del(k: string) {
      store.delete(k)
      return 1
    },
  }
})
const on = vi.hoisted(() => ({ value: true }))
vi.mock("@/lib/cache/redis", async (orig) => ({
  ...(await orig<typeof import("@/lib/cache/redis")>()),
  getRedis: () => (on.value ? redis : null),
}))

import { checksQuiet, setChecksQuietUntil } from "@/lib/checks/quiet"

const now = new Date("2026-11-21T00:30Z")

beforeEach(() => {
  redis.store.clear()
  redis.fail = false
  on.value = true
})

describe("checks quiet-until", () => {
  it("is quiet before the saved moment and not at or after it", async () => {
    await setChecksQuietUntil(new Date("2026-11-21T01:30Z"), now)
    expect(await checksQuiet(now)).toBe(true)
    expect(await checksQuiet(new Date("2026-11-21T01:30Z"))).toBe(false)
  })

  it("is not quiet once cleared, or with nothing saved", async () => {
    expect(await checksQuiet(now)).toBe(false)
    await setChecksQuietUntil(new Date("2026-11-21T01:30Z"), now)
    await setChecksQuietUntil(null)
    expect(await checksQuiet(now)).toBe(false)
  })

  it("never claims quiet without Redis or when Redis fails, and never throws", async () => {
    await setChecksQuietUntil(new Date("2026-11-21T01:30Z"), now)
    redis.fail = true
    expect(await checksQuiet(now)).toBe(false)
    await expect(setChecksQuietUntil(null)).resolves.toBeUndefined()
    on.value = false
    expect(await checksQuiet(now)).toBe(false)
  })
})
