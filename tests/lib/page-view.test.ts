import { describe, it, expect } from "vitest"
import {
  normalizeRoute,
  isTrackablePath,
  clampDwell,
  resolveEnteredAt,
  stepTracker,
  MAX_DWELL_MS,
  type TrackerEntry,
  type TrackerEvent,
} from "@/lib/monitoring/page-view"

describe("normalizeRoute", () => {
  it("leaves static paths alone", () => {
    expect(normalizeRoute("/dashboard")).toBe("/dashboard")
    expect(normalizeRoute("/dashboard/orders")).toBe("/dashboard/orders")
    expect(normalizeRoute("/dashboard/menu-profit")).toBe("/dashboard/menu-profit")
  })

  it("collapses the id segment after a known dynamic base", () => {
    expect(normalizeRoute("/dashboard/orders/clx8f2abcdefghijklmnopq")).toBe(
      "/dashboard/orders/[id]",
    )
    expect(normalizeRoute("/m/invoices/inv-not-a-cuid")).toBe("/m/invoices/[id]")
  })

  it("labels the pnl store segment by its real route name", () => {
    expect(normalizeRoute("/dashboard/pnl/clx8f2abcdefghijklmnopq")).toBe(
      "/dashboard/pnl/[storeId]",
    )
    expect(normalizeRoute("/m/pnl/clx8f2abcdefghijklmnopq")).toBe(
      "/m/pnl/[storeId]",
    )
  })

  it("keeps sub-paths after the collapsed segment", () => {
    expect(normalizeRoute("/dashboard/orders/clx8f2abcdefghijklmnopq/items")).toBe(
      "/dashboard/orders/[id]/items",
    )
  })

  it("collapses nested id segments under a known base", () => {
    expect(
      normalizeRoute("/dashboard/orders/clx8f2abcdefghijklmnopq/refunds/12345"),
    ).toBe("/dashboard/orders/[id]/refunds/[id]")
  })

  it("strips query string, hash and trailing slash", () => {
    expect(normalizeRoute("/dashboard/invoices/abc123?tab=lines")).toBe(
      "/dashboard/invoices/[id]",
    )
    expect(normalizeRoute("/dashboard/orders/")).toBe("/dashboard/orders")
    expect(normalizeRoute("/dashboard#top")).toBe("/dashboard")
  })

  it("collapses id-shaped segments outside known bases", () => {
    expect(normalizeRoute("/dashboard/stores/12345")).toBe("/dashboard/stores/[id]")
    expect(
      normalizeRoute("/dashboard/stores/3f2504e0-4f89-11d3-9a0c-0305e82c3301"),
    ).toBe("/dashboard/stores/[id]")
  })

  it("is idempotent on already-normalized input", () => {
    expect(normalizeRoute("/dashboard/orders/[id]")).toBe("/dashboard/orders/[id]")
  })

  it("truncates paths longer than MAX_PATH_LEN to at most 200 chars", () => {
    const longPath = "/dashboard/orders/" + "a".repeat(300)
    const normalized = normalizeRoute(longPath)
    expect(normalized.length).toBeLessThanOrEqual(200)
  })
})

describe("isTrackablePath", () => {
  it("accepts dashboard and mobile surfaces", () => {
    expect(isTrackablePath("/dashboard")).toBe(true)
    expect(isTrackablePath("/dashboard/pnl")).toBe(true)
    expect(isTrackablePath("/m")).toBe(true)
    expect(isTrackablePath("/m/orders")).toBe(true)
  })

  it("rejects everything else", () => {
    expect(isTrackablePath("/login")).toBe(false)
    expect(isTrackablePath("/api/telemetry/page-view")).toBe(false)
    expect(isTrackablePath("/")).toBe(false)
    expect(isTrackablePath("/mobile-marketing")).toBe(false)
  })
})

describe("clampDwell", () => {
  it("passes through a normal duration", () => {
    expect(clampDwell(4200)).toBe(4200)
  })

  it("returns null for null, undefined and non-finite input", () => {
    expect(clampDwell(null)).toBeNull()
    expect(clampDwell(undefined)).toBeNull()
    expect(clampDwell(NaN)).toBeNull()
    expect(clampDwell(Infinity)).toBeNull()
  })

  it("floors negatives at zero", () => {
    expect(clampDwell(-500)).toBe(0)
  })

  it("caps a weekend-long tab at the max", () => {
    expect(clampDwell(72 * 60 * 60 * 1000)).toBe(MAX_DWELL_MS)
  })

  it("rounds fractional milliseconds", () => {
    expect(clampDwell(1234.6)).toBe(1235)
  })
})

describe("resolveEnteredAt", () => {
  const now = 1_770_000_000_000

  it("trusts a plausible client timestamp", () => {
    expect(resolveEnteredAt(now - 30_000, now).getTime()).toBe(now - 30_000)
  })

  it("falls back to now when the client clock is in the future", () => {
    expect(resolveEnteredAt(now + 10 * 60_000, now).getTime()).toBe(now)
  })

  it("falls back to now when the timestamp is older than a day", () => {
    expect(resolveEnteredAt(now - 48 * 60 * 60_000, now).getTime()).toBe(now)
  })

  it("falls back to now for non-finite input", () => {
    expect(resolveEnteredAt(NaN, now).getTime()).toBe(now)
  })
})

describe("stepTracker", () => {
  type Emitted = NonNullable<ReturnType<typeof stepTracker>["emit"]>

  /** Drive the reducer the way the effect does: one ref, one emit sink. */
  function run(steps: Array<[TrackerEvent, string | null, number]>): {
    emitted: Emitted[]
    entry: TrackerEntry | null
  } {
    let entry: TrackerEntry | null = null
    const emitted: Emitted[] = []
    for (const [event, path, now] of steps) {
      const step = stepTracker(entry, event, path, now)
      entry = step.next
      if (step.emit) emitted.push(step.emit)
    }
    return { emitted, entry }
  }

  it("emits nothing for a null entry, whatever the event", () => {
    for (const event of ["navigate", "hide", "show", "unmount"] as TrackerEvent[]) {
      expect(stepTracker(null, event, "/dashboard", 1000).emit).toBeNull()
    }
  })

  it("records the whole visit across a tab switch", () => {
    // The bug this exists for: open /pnl, switch tabs at 10s, come back at
    // 60s, read for 25 minutes, then navigate away. The 25 minutes must land.
    const mount = 1_000_000
    const hide = mount + 10_000
    const show = mount + 60_000
    const navigate = show + 25 * 60_000

    const { emitted } = run([
      ["navigate", "/dashboard/pnl", mount],
      ["hide", "/dashboard/pnl", hide],
      ["show", "/dashboard/pnl", show],
      ["navigate", "/dashboard/orders", navigate],
    ])

    expect(emitted).toHaveLength(2)
    expect(emitted[0]).toEqual({
      path: "/dashboard/pnl",
      enteredAt: mount,
      dwellMs: 10_000,
    })
    expect(emitted[1]).toEqual({
      path: "/dashboard/pnl",
      enteredAt: show,
      dwellMs: 25 * 60_000,
    })
    // The two dwells cover every visible millisecond; only the backgrounded
    // stretch is excluded, which is the point of measuring dwell at all.
    const totalDwell = emitted.reduce((n, e) => n + e.dwellMs, 0)
    expect(totalDwell).toBe(navigate - mount - (show - hide))
  })

  it("keeps the resumed view in the same session as the next page", () => {
    // Regression guard for the session-inflation half of the bug: the gap
    // between the resumed view's end and the next view's start is zero, not
    // the 25 minutes the old code would have left behind.
    const mount = 0
    const { emitted } = run([
      ["navigate", "/dashboard/pnl", mount],
      ["hide", "/dashboard/pnl", 10_000],
      ["show", "/dashboard/pnl", 60_000],
      ["navigate", "/dashboard/orders", 60_000 + 25 * 60_000],
    ])
    const resumed = emitted[1]!
    expect(resumed.enteredAt + resumed.dwellMs).toBe(60_000 + 25 * 60_000)
  })

  it("emits once when hide fires twice", () => {
    const { emitted } = run([
      ["navigate", "/dashboard", 0],
      ["hide", "/dashboard", 5_000],
      ["hide", "/dashboard", 6_000],
    ])
    expect(emitted).toHaveLength(1)
    expect(emitted[0]!.dwellMs).toBe(5_000)
  })

  it("keeps the flushed entry after hide so a later hide is provably silent", () => {
    const step = stepTracker(
      { path: "/dashboard", enteredAt: 0, flushed: false },
      "hide",
      "/dashboard",
      5_000,
    )
    expect(step.next).toEqual({ path: "/dashboard", enteredAt: 0, flushed: true })
  })

  it("emits once per page across navigate then unmount", () => {
    const { emitted, entry } = run([
      ["navigate", "/dashboard", 0],
      ["navigate", "/dashboard/pnl", 4_000],
      ["unmount", "/dashboard/pnl", 9_000],
    ])
    expect(emitted).toEqual([
      { path: "/dashboard", enteredAt: 0, dwellMs: 4_000 },
      { path: "/dashboard/pnl", enteredAt: 4_000, dwellMs: 5_000 },
    ])
    expect(entry).toBeNull()
  })

  it("does not double-write when unmount follows a flush", () => {
    // pagehide then teardown — one dismissal, one row.
    const { emitted } = run([
      ["navigate", "/dashboard", 0],
      ["hide", "/dashboard", 3_000],
      ["unmount", "/dashboard", 3_100],
    ])
    expect(emitted).toHaveLength(1)
  })

  it("survives strict mode's doubled effect without double-counting", () => {
    const { emitted } = run([
      ["navigate", "/dashboard", 0],
      ["unmount", "/dashboard", 0],
      ["navigate", "/dashboard", 0],
    ])
    expect(emitted).toEqual([{ path: "/dashboard", enteredAt: 0, dwellMs: 0 }])
  })

  it("starts a fresh measured view on show", () => {
    const step = stepTracker(
      { path: "/dashboard", enteredAt: 0, flushed: true },
      "show",
      "/dashboard",
      90_000,
    )
    expect(step.emit).toBeNull()
    expect(step.next).toEqual({
      path: "/dashboard",
      enteredAt: 90_000,
      flushed: false,
    })
  })

  it("tracks nothing when there is no path to attribute the view to", () => {
    expect(stepTracker(null, "navigate", null, 0).next).toBeNull()
    expect(stepTracker(null, "show", null, 0).next).toBeNull()
  })
})
