import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  groupIntoSessions,
  countStreak,
  dayKey,
  SESSION_GAP_MS,
  type ViewRow,
} from "@/lib/monitoring/engagement"

const base = new Date("2026-08-10T14:00:00.000Z").getTime()

function view(offsetMs: number, dwellMs: number | null, path = "/dashboard"): ViewRow {
  return { path, route: path, enteredAt: new Date(base + offsetMs), dwellMs }
}

describe("groupIntoSessions", () => {
  it("returns nothing for no views", () => {
    expect(groupIntoSessions([])).toEqual([])
  })

  it("treats a single view as one session", () => {
    const [s, ...rest] = groupIntoSessions([view(0, 30_000, "/dashboard/pnl")])
    expect(rest).toHaveLength(0)
    expect(s.pageCount).toBe(1)
    expect(s.durationMs).toBe(30_000)
    expect(s.entryPath).toBe("/dashboard/pnl")
    expect(s.exitPath).toBe("/dashboard/pnl")
  })

  it("keeps views in one session when the gap is exactly the threshold", () => {
    const views = [view(0, 1000), view(1000 + SESSION_GAP_MS, 1000)]
    expect(groupIntoSessions(views)).toHaveLength(1)
  })

  it("splits when the gap exceeds the threshold", () => {
    const views = [view(0, 1000), view(1000 + SESSION_GAP_MS + 1, 1000)]
    const sessions = groupIntoSessions(views)
    expect(sessions).toHaveLength(2)
    expect(sessions[0].pageCount).toBe(1)
    expect(sessions[1].pageCount).toBe(1)
  })

  it("carries entry and exit paths across a multi-page session", () => {
    const views = [
      view(0, 5_000, "/dashboard"),
      view(5_000, 10_000, "/dashboard/pnl"),
      view(15_000, 2_000, "/dashboard/orders"),
    ]
    const [s] = groupIntoSessions(views)
    expect(s.pageCount).toBe(3)
    expect(s.entryPath).toBe("/dashboard")
    expect(s.exitPath).toBe("/dashboard/orders")
    expect(s.durationMs).toBe(17_000)
  })

  it("treats a null dwell as zero when closing a session", () => {
    const [s] = groupIntoSessions([view(0, 5_000), view(5_000, null)])
    expect(s.endedAt.getTime()).toBe(base + 5_000)
    expect(s.durationMs).toBe(5_000)
  })

  it("sorts unordered input before grouping", () => {
    const views = [view(10_000, 1_000, "/b"), view(0, 1_000, "/a")]
    const [s] = groupIntoSessions(views)
    expect(s.entryPath).toBe("/a")
    expect(s.exitPath).toBe("/b")
  })

  it("does not split a session that spans midnight", () => {
    const late = new Date("2026-08-10T23:55:00.000Z").getTime()
    const views: ViewRow[] = [
      { path: "/a", route: "/a", enteredAt: new Date(late), dwellMs: 60_000 },
      { path: "/b", route: "/b", enteredAt: new Date(late + 10 * 60_000), dwellMs: 60_000 },
    ]
    expect(groupIntoSessions(views)).toHaveLength(1)
  })
})

describe("countStreak", () => {
  it("counts consecutive days ending today", () => {
    expect(countStreak(["2026-08-13", "2026-08-12", "2026-08-11"], "2026-08-13")).toBe(3)
  })

  it("still counts a streak that ended yesterday", () => {
    expect(countStreak(["2026-08-12", "2026-08-11"], "2026-08-13")).toBe(2)
  })

  it("is zero when the most recent day is older than yesterday", () => {
    expect(countStreak(["2026-08-01"], "2026-08-13")).toBe(0)
  })

  it("stops at the first missing day", () => {
    expect(countStreak(["2026-08-13", "2026-08-11", "2026-08-10"], "2026-08-13")).toBe(1)
  })

  it("is zero for no active days", () => {
    expect(countStreak([], "2026-08-13")).toBe(0)
  })
})

describe("dayKey", () => {
  it("formats as YYYY-MM-DD", () => {
    expect(dayKey(new Date("2026-08-03T19:00:00.000Z"))).toBe("2026-08-03")
  })

  it("buckets by Los Angeles time, not the UTC the server runs in", () => {
    // 7pm PT on the 12th. UTC has already rolled over to the 13th, so a
    // server-local (UTC) bucket would file the owner's evening under tomorrow.
    expect(dayKey(new Date("2026-08-13T02:00:00.000Z"))).toBe("2026-08-12")
    // And the reverse edge: just past LA midnight is still the new day.
    expect(dayKey(new Date("2026-08-13T07:30:00.000Z"))).toBe("2026-08-13")
  })

  it("uses PST, not a fixed offset, in winter", () => {
    // 5pm PST on Jan 2; UTC is already Jan 3.
    expect(dayKey(new Date("2026-01-03T01:00:00.000Z"))).toBe("2026-01-02")
  })
})

describe("countStreak day arithmetic", () => {
  // shiftDay walks backwards from the today key. It must stay pure string
  // arithmetic — a round trip through a local-time Date would drift a day on
  // a UTC server and silently truncate every streak that crosses a month end.
  it("crosses a month boundary", () => {
    expect(countStreak(["2026-08-01", "2026-07-31", "2026-07-30"], "2026-08-01")).toBe(3)
  })

  it("crosses a year boundary", () => {
    expect(countStreak(["2026-01-01", "2025-12-31"], "2026-01-01")).toBe(2)
  })

  it("crosses a leap day", () => {
    expect(countStreak(["2028-03-01", "2028-02-29", "2028-02-28"], "2028-03-01")).toBe(3)
  })
})
