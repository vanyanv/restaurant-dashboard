// Unit tests for the monitoring time-range model — the canonical range
// presets, the URL-param parser, and the window resolver that every
// monitoring page uses to drive its queries off a single ?range= value.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  RANGES,
  DEFAULT_RANGE,
  parseRange,
  resolveWindow,
  windowFromArg,
  truncLiteral,
} from "@/lib/monitoring/time-range"

const NOW = new Date("2026-06-12T12:00:00Z")

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("RANGES", () => {
  it("exposes the five canonical presets in ascending order", () => {
    expect(RANGES.map((r) => r.key)).toEqual(["1h", "6h", "24h", "7d", "30d"])
  })
})

describe("parseRange", () => {
  it("returns a valid preset key unchanged", () => {
    expect(parseRange("7d")).toBe("7d")
  })

  it("falls back to the default for an unknown value", () => {
    expect(parseRange("99y")).toBe(DEFAULT_RANGE)
  })

  it("falls back to the default for undefined", () => {
    expect(parseRange(undefined)).toBe(DEFAULT_RANGE)
  })

  it("takes the first entry when given an array (repeated query param)", () => {
    expect(parseRange(["6h", "24h"])).toBe("6h")
  })
})

describe("resolveWindow", () => {
  it("anchors `until` to now and sets `since` back by the preset's hours", () => {
    const w = resolveWindow("6h")
    expect(w.until).toEqual(NOW)
    expect(w.since).toEqual(new Date("2026-06-12T06:00:00Z"))
    expect(w.hours).toBe(6)
  })

  it("buckets by hour for windows up to 48h", () => {
    expect(resolveWindow("24h").bucket).toBe("hour")
  })

  it("buckets by day for windows longer than 48h", () => {
    expect(resolveWindow("7d").bucket).toBe("day")
    expect(resolveWindow("30d").bucket).toBe("day")
  })

  it("carries the resolved range key through", () => {
    expect(resolveWindow("30d").range).toBe("30d")
  })
})

describe("windowFromArg (back-compat shim for query fns)", () => {
  it("treats a numeric arg as hours-back, until=now, hourly bucket", () => {
    expect(windowFromArg(6)).toEqual({
      since: new Date("2026-06-12T06:00:00Z"),
      until: NOW,
      bucket: "hour",
    })
  })

  it("passes a TimeWindow through as since/until/bucket", () => {
    const w = resolveWindow("7d")
    expect(windowFromArg(w)).toEqual({
      since: w.since,
      until: w.until,
      bucket: "day",
    })
  })
})

describe("truncLiteral", () => {
  it("maps the bucket to a quoted Postgres date_trunc unit", () => {
    expect(truncLiteral("hour")).toBe("'hour'")
    expect(truncLiteral("day")).toBe("'day'")
  })
})
