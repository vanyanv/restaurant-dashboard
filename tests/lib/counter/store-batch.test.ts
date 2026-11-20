import { describe, expect, it, vi } from "vitest"

// A render's `cache`: one value for the whole test file, like one request.
vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>()
  return {
    ...actual,
    cache: <T extends (...a: never[]) => unknown>(fn: T) => {
      let v: unknown
      let set = false
      return ((...a: never[]) => {
        if (!set) {
          v = fn(...a)
          set = true
        }
        return v
      }) as T
    },
  }
})

import { batchedStoreRows, sumByDate } from "@/lib/counter/store-batch"

const rows = [
  { storeId: "a", v: 1 },
  { storeId: "b", v: 2 },
  { storeId: "c", v: 3 },
]

describe("batchedStoreRows", () => {
  it("reads every store once and gives each caller only its stores", async () => {
    const load = vi.fn(async (ids: string[]) => rows.filter((r) => ids.includes(r.storeId)))
    const ask = (storeIds: string[]) => batchedStoreRows({ group: "g1", storeIds, load, storeOf: (r) => r.storeId })
    const [all, onlyB] = await Promise.all([ask(["a", "b", "c"]), ask(["b"])])
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith(["a", "b", "c"])
    expect(all.map((r) => r.v)).toEqual([1, 2, 3])
    expect(onlyB.map((r) => r.v)).toEqual([2])
  })

  it("cuts a late caller from a read already made for its stores", async () => {
    const load = vi.fn(async (ids: string[]) => rows.filter((r) => ids.includes(r.storeId)))
    const ask = (storeIds: string[]) => batchedStoreRows({ group: "g2", storeIds, load, storeOf: (r) => r.storeId })
    await ask(["a", "b", "c"])
    const late = await ask(["c"])
    expect(load).toHaveBeenCalledTimes(1)
    expect(late.map((r) => r.v)).toEqual([3])
  })
})

describe("sumByDate", () => {
  it("sums per-store rows back to one row per date, keeping an all-null sum null", () => {
    const d1 = new Date("2026-11-01T00:00:00.000Z")
    const d2 = new Date("2026-11-02T00:00:00.000Z")
    const out = sumByDate(
      [
        { date: d1, _sum: { n: 2 } },
        { date: d1, _sum: { n: 3 } },
        { date: d2, _sum: { n: null } },
      ],
      ["n"] as const,
    )
    expect(out).toEqual([
      { date: d1, _sum: { n: 5 } },
      { date: d2, _sum: { n: null } },
    ])
  })
})
