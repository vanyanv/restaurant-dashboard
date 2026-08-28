// Month cache tags — which cached P&L statements a writer invalidates.
//
// These assert one property above all others, and it is a money property: a
// writer that wrote a day inside a cached range MUST bust that range. Getting
// it wrong in that direction leaves a stale figure on the P&L with nothing to
// signal it. The opposite direction — busting a range that did not change —
// costs one refetch and is the side every ambiguous case here is resolved
// toward.
//
// `@/lib/cache/cached` reaches `@/lib/monitoring/{errors,cache-stats}`, both of
// which import Prisma at module load, so Prisma is mocked to keep this a pure
// unit test of the tag arithmetic.

import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { monthTags, monthTagsForDates, monthTagsForRange } from "@/lib/cache/cached"
import { toQueryBounds } from "@/lib/counter/date-range"

/** The `Date.UTC(localY, localM, localD)` shape `toQueryBounds` produces. */
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))

describe("monthTags", () => {
  it("gives one tag for a range inside a single month", () => {
    expect(monthTags(utc(2026, 8, 3), utc(2026, 8, 29))).toEqual(["pnl:m:2026-08"])
  })

  it("covers every month a range spans, inclusive of both ends", () => {
    // The trailing-eight-week window is the case that motivated this: it
    // routinely straddles two or three months, and every one of them has to be
    // a tag or a sync into the earliest month would not reach the key.
    expect(monthTags(utc(2026, 6, 28), utc(2026, 9, 2))).toEqual([
      "pnl:m:2026-06",
      "pnl:m:2026-07",
      "pnl:m:2026-08",
      "pnl:m:2026-09",
    ])
  })

  it("crosses a year boundary", () => {
    expect(monthTags(utc(2025, 11, 20), utc(2026, 1, 4))).toEqual([
      "pnl:m:2025-11",
      "pnl:m:2025-12",
      "pnl:m:2026-01",
    ])
  })

  it("pads the month so tags sort and compare as strings", () => {
    expect(monthTags(utc(2026, 1, 1), utc(2026, 1, 31))).toEqual(["pnl:m:2026-01"])
  })

  it("tolerates a reversed range rather than returning nothing", () => {
    // `?from=…&to=…` is user input. `readCounterParams` rejects an inverted
    // range today, but a tag function that silently returned [] for one would
    // produce a key no bust can reach.
    expect(monthTags(utc(2026, 9, 2), utc(2026, 7, 1))).toEqual([
      "pnl:m:2026-07",
      "pnl:m:2026-08",
      "pnl:m:2026-09",
    ])
  })

  it("falls back to the wide tag for a range too long to enumerate", () => {
    // Twenty years of months on one key would be 240 sadd's per cache write.
    expect(monthTags(utc(2010, 1, 1), utc(2030, 1, 1))).toEqual(["pnl:m:wide"])
  })

  it("falls back to the wide tag for an unparseable bound", () => {
    expect(monthTags(new Date(NaN), utc(2026, 8, 1))).toEqual(["pnl:m:wide"])
  })
})

describe("monthTagsForDates", () => {
  it("reads the LA calendar days the hourly sync reports", () => {
    // `HourlySyncResult.datesCovered` is `YYYY-MM-DD`.
    expect(monthTagsForDates(["2026-08-27", "2026-08-28"]).sort()).toEqual([
      "pnl:m:2026-08",
      "pnl:m:wide",
    ])
  })

  it("busts both months when the sync window straddles one", () => {
    expect(monthTagsForDates(["2026-07-31", "2026-08-01"]).sort()).toEqual([
      "pnl:m:2026-07",
      "pnl:m:2026-08",
      "pnl:m:wide",
    ])
  })

  it("always includes the wide tag, so a wide-tagged key is never stranded", () => {
    // A key whose range was too long to enumerate carries ONLY `pnl:m:wide`.
    // If a narrow bust omitted it, that key could never be invalidated by the
    // hourly sync and would serve a stale statement until its TTL expired.
    expect(monthTagsForDates(["2026-08-27"])).toContain("pnl:m:wide")
    expect(monthTagsForRange(utc(2026, 8, 1), utc(2026, 8, 2))).toContain("pnl:m:wide")
  })

  it("skips an unparseable date instead of dropping the whole bust", () => {
    expect(monthTagsForDates(["not-a-date", "2026-08-27"]).sort()).toEqual([
      "pnl:m:2026-08",
      "pnl:m:wide",
    ])
  })

  it("returns the wide tag alone when the writer wrote nothing datable", () => {
    expect(monthTagsForDates([])).toEqual(["pnl:m:wide"])
  })
})

describe("the key side and the bust side agree", () => {
  // The whole point. A day written inside a cached range must produce a tag
  // the key carries — otherwise the reader keeps a stale statement.
  const overlaps = (a: string[], b: string[]) => a.some((t) => b.includes(t))

  it("busts a range whose month the sync wrote", () => {
    const key = monthTags(utc(2026, 8, 1), utc(2026, 8, 28))
    expect(overlaps(key, monthTagsForDates(["2026-08-27"]))).toBe(true)
  })

  it("busts a multi-month range from a sync in ANY of its months", () => {
    const key = monthTags(utc(2026, 6, 28), utc(2026, 9, 2))
    for (const d of ["2026-06-30", "2026-07-15", "2026-08-01", "2026-09-01"]) {
      expect(overlaps(key, monthTagsForDates([d]))).toBe(true)
    }
  })

  it("leaves a range alone when the sync wrote a different month", () => {
    // This is the saving. An hourly sync writing August must not evict the
    // September-only statement a reader is looking at.
    const key = monthTags(utc(2026, 9, 1), utc(2026, 9, 30))
    expect(overlaps(key, monthTagsForDates(["2026-08-27", "2026-08-28"]))).toBe(false)
  })

  it("reaches a wide-tagged key from any sync", () => {
    const key = monthTags(utc(2010, 1, 1), utc(2030, 1, 1))
    expect(overlaps(key, monthTagsForDates(["2026-08-27"]))).toBe(true)
  })

  it("agrees on the month for a range built by toQueryBounds", () => {
    // The two sides only line up because `toQueryBounds` writes the LOCAL
    // calendar day into a UTC date (`Date.UTC(localY, localM, localD)`), so a
    // key's UTC month is its local month — the same month `datesCovered`'s
    // `YYYY-MM-DD` parses to. If that ever changes, a range starting on the
    // 1st could tag the previous month and this fails.
    const bounds = toQueryBounds({
      start: new Date(2026, 7, 1), // 1 Aug, local
      end: new Date(2026, 7, 31),
    })
    expect(monthTags(bounds.startDate, bounds.endDate)).toEqual(["pnl:m:2026-08"])
    expect(
      overlaps(
        monthTags(bounds.startDate, bounds.endDate),
        monthTagsForDates(["2026-08-01", "2026-08-31"]),
      ),
    ).toBe(true)
  })
})
