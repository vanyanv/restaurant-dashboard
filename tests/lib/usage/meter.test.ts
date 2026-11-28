import { beforeEach, describe, expect, it } from "vitest"
import {
  bindTrace,
  count,
  currentSource,
  oldestAgeMs,
  resetMeterForTest,
  setDefaultSource,
  sourceOfTrace,
  takePending,
} from "@/lib/usage/meter"

const H1 = new Date("2026-11-28T08:10:00Z")
const H2 = new Date("2026-11-28T09:59:59Z")
const rowsWithoutCpu = () => (takePending()?.rows ?? []).filter((r) => r[2] !== "cpuMs")

describe("meter", () => {
  beforeEach(() => resetMeterForTest())

  it("sums counts in the same hour into one row", () => {
    count("tv", "calls", 1, H1)
    count("tv", "calls", 1, H1)
    expect(rowsWithoutCpu()).toEqual([["2026-11-28T08:00:00.000Z", "tv", "calls", 2]])
  })

  it("keeps hours apart", () => {
    count("tv", "calls", 1, H1)
    count("tv", "calls", 3, H2)
    expect(rowsWithoutCpu()).toEqual([
      ["2026-11-28T08:00:00.000Z", "tv", "calls", 1],
      ["2026-11-28T09:00:00.000Z", "tv", "calls", 3],
    ])
  })

  it("hands over a payload once, with one cpu row", () => {
    count("phone", "wallMs", 12.5, H1)
    const payload = takePending()
    expect(payload?.v).toBe(1)
    expect(payload?.instance).toMatch(/^[0-9a-f]{8}$/)
    const cpu = payload!.rows.filter((r) => r[2] === "cpuMs")
    expect(cpu).toHaveLength(1)
    expect(cpu[0][1]).toBe("all")
    expect(cpu[0][3]).toBeGreaterThanOrEqual(0)
    expect(takePending()).toBeNull()
  })

  it("ignores values that are not a positive finite number", () => {
    count("tv", "calls", Number.NaN, H1)
    count("tv", "calls", -1, H1)
    count("tv", "calls", Number.POSITIVE_INFINITY, H1)
    expect(takePending()).toBeNull()
  })

  it("folds new keys into other past 2,000", () => {
    for (let i = 0; i < 2000; i++) count("tv", `m${i}`, 1, H1)
    count("tv", "calls", 1, H1)
    count("crew", "calls", 1, H1)
    const rows = rowsWithoutCpu()
    expect(rows).toHaveLength(2001)
    expect(rows.at(-1)).toEqual(["2026-11-28T08:00:00.000Z", "other", "calls", 2])
  })

  it("reports the age of the oldest unflushed count", () => {
    expect(oldestAgeMs(1000)).toBe(0)
    count("tv", "calls")
    expect(oldestAgeMs(Date.now() + 60_000)).toBeGreaterThanOrEqual(60_000)
    takePending()
    expect(oldestAgeMs()).toBe(0)
  })

  it("drops the oldest trace past 5,000", () => {
    for (let i = 0; i <= 5000; i++) bindTrace(`t${i}`, "tv")
    expect(sourceOfTrace("t0")).toBeUndefined()
    expect(sourceOfTrace("t1")).toBe("tv")
    expect(sourceOfTrace("t5000")).toBe("tv")
  })

  it("falls back to the default source with no active span", () => {
    expect(currentSource()).toBe("other")
    setDefaultSource("sync")
    expect(currentSource()).toBe("sync")
  })
})
