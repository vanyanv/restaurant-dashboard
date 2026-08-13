import { describe, it, expect } from "vitest"
import {
  normalizeRoute,
  isTrackablePath,
  clampDwell,
  resolveEnteredAt,
  MAX_DWELL_MS,
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
