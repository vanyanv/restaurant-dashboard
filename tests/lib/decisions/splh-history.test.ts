import { describe, expect, it } from "vitest"
import { foldSplhHistory } from "@/lib/decisions/splh-history"

describe("foldSplhHistory", () => {
  it("counts a store-day's sales once, however the hours were folded", () => {
    const rows = foldSplhHistory({
      hours: [{ storeId: "a", day: "2026-10-19", hours: 40 }],
      net: new Map([["a|2026-10-19", 4000]]),
    })
    expect(rows).toEqual([{ day: "2026-10-19", hours: 40, net: 4000, unsynced: 0 }])
  })

  it("sums stores per day and keeps one row per day", () => {
    const rows = foldSplhHistory({
      hours: [
        { storeId: "a", day: "2026-10-19", hours: 40 },
        { storeId: "b", day: "2026-10-19", hours: 30 },
      ],
      net: new Map([
        ["a|2026-10-19", 4000],
        ["b|2026-10-19", 2500],
      ]),
    })
    expect(rows).toEqual([{ day: "2026-10-19", hours: 70, net: 6500, unsynced: 0 }])
  })

  it("counts a store that worked with no sales figure as unsynced", () => {
    const rows = foldSplhHistory({
      hours: [
        { storeId: "a", day: "2026-10-19", hours: 40 },
        { storeId: "b", day: "2026-10-19", hours: 30 },
      ],
      net: new Map([["a|2026-10-19", 4000]]),
    })
    expect(rows[0]).toMatchObject({ hours: 70, net: 4000, unsynced: 1 })
  })

  it("leaves net null when no store had a figure", () => {
    const rows = foldSplhHistory({
      hours: [{ storeId: "a", day: "2026-10-19", hours: 8 }],
      net: new Map(),
    })
    expect(rows[0]).toMatchObject({ net: null, unsynced: 1 })
  })
})
