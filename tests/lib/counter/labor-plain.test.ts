import { describe, expect, it } from "vitest"
import { buildLaborPlain, type LaborPlainInput } from "@/lib/counter/labor-plain"

const week = (over: Partial<LaborPlainInput> = {}): LaborPlainInput => ({
  laborPct: 24.1,
  cost: 26_400,
  hours: 1_120,
  scheduledHours: 1_102,
  missingStoreDays: 0,
  splh: 98.2,
  leak: null,
  prior: { label: "Oct 19", laborPct: 23.3 },
  ...over,
})

describe("buildLaborPlain", () => {
  it("says the share, the cost, the hours and the schedule in one sentence", () => {
    const p = buildLaborPlain(week({ hours: 1_200 }))
    expect(p.sentence).toBe("Labor was 24.1% of sales, $26,400 for 1,200 hours. That is 98 hours over the 1,102 hours published.")
    expect(p.statuses).toEqual([{ tone: "warn", text: "98 h over schedule" }])
  })

  it("reads a rising share against last week as the bad direction", () => {
    expect(buildLaborPlain(week()).vs).toEqual({ change: "▲ 0.8 pts", tone: "down", against: "vs week of Oct 19" })
    expect(buildLaborPlain(week({ prior: { label: "Oct 19", laborPct: 25 } })).vs?.tone).toBe("up")
    expect(buildLaborPlain(week({ prior: null })).vs).toBeNull()
  })

  it("labels missing labor days and a missing schedule rather than counting them as nothing", () => {
    const p = buildLaborPlain(week({ missingStoreDays: 2, scheduledHours: null }))
    expect(p.sentence).toContain("of sales on the days with hours")
    expect(p.sentence).toContain("2 store-days are missing labor, so the total cost is higher.")
    expect(p.big.missing).toBe("labor missing on 2 store-days")
    expect(p.lines.find((l) => l.key === "scheduled")!.value).toBe("no schedule")
    expect(p.statuses.map((s) => s.text)).toEqual(["No schedule published", "Labor missing on 2 store-days"])
  })

  it("says no labor is on file rather than $0 when the days that sold have no reading", () => {
    const p = buildLaborPlain(week({ laborPct: null, cost: 0, hours: 0, missingStoreDays: 7, prior: null }))
    expect(p.sentence).toBe(
      "No labor is on file for the days that sold, so there is no labor share yet. 7 store-days are missing labor, so the total cost is higher.",
    )
    expect(p.big).toMatchObject({ value: null, sub: "" })
    expect(p.statuses.map((s) => s.text)).toEqual(["Labor missing on 7 store-days"])
  })

  it("names the clock leak, and has no share without sales", () => {
    const p = buildLaborPlain(week({ laborPct: null, leak: { hours: 6.5, cost: 120 } }))
    expect(p.big.value).toBeNull()
    expect(p.vs).toBeNull()
    expect(p.sentence).toContain("with no sales in this range to set it against")
    expect(p.sentence).toContain("Clock-in and clock-out alerts add up to 6.5 hours, about $120.")
  })
})
