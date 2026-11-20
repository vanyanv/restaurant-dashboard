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

  it("never praises a gap made of days Harri has not sent: compares only days with hours", () => {
    // The audit's case: 50 h worked against 178 h published, two days still waiting.
    const p = buildLaborPlain(
      week({
        hours: 50,
        scheduledHours: 178,
        compare: { actualHours: 50, scheduledHours: 50.5 },
        awaitingDays: ["Tue Nov 18", "Wed Nov 19"],
      }),
    )
    expect(p.sentence).not.toContain("128")
    expect(p.sentence).toContain("The schedule held on the days with hours: 51 hours published.")
    expect(p.sentence).toContain("2 days are still waiting on Harri for hours worked (Tue Nov 18 and Wed Nov 19)")
    expect(p.statuses.map((s) => s.text)).toContain("2 days still waiting on Harri")
    expect(p.lines.find((l) => l.key === "scheduled")!.value).toBe("50.5 h on days with hours · 178.0 h in all")
  })

  it("does not paint running under the schedule green while the figures are provisional", () => {
    const p = buildLaborPlain(
      week({ hours: 40, scheduledHours: 52, compare: { actualHours: 40, scheduledHours: 52 }, provisionalDays: ["Wed Nov 19"] }),
    )
    expect(p.statuses.find((s) => s.text.endsWith("under schedule"))!.tone).toBe("warn")
    expect(p.statuses.map((s) => s.text)).toContain("Provisional: Wed Nov 19")
    expect(p.big.label).toBe("Labor, share of sales · provisional")
    expect(p.sentence).toContain("Labor was 24.1% of sales so far")
  })

  it("leads with time records that need fixing and marks the share provisional", () => {
    const p = buildLaborPlain(week({ missed: { missedIn: 13, missedOut: 3 } }))
    expect(p.sentence.startsWith("Time records need fixing: 13 missed clock-ins, 3 missed clock-outs.")).toBe(true)
    expect(p.statuses[0]).toEqual({ tone: "warn", text: "Time records need fixing: 13 missed clock-ins, 3 missed clock-outs" })
    expect(p.big.label).toContain("provisional")
  })

  it("says labor looks incomplete instead of printing 2.2% plainly", () => {
    const p = buildLaborPlain(
      week({ laborPct: 2.2, incomplete: [{ name: "Glendale", laborPct: 2.2 }], storeCount: 1 }),
    )
    expect(p.big.value).toBeNull()
    expect(p.big.missing).toBe("Labor looks incomplete for Glendale")
    expect(p.vs).toBeNull()
    expect(p.statuses.map((s) => s.text)).toContain("Labor looks incomplete for Glendale")
    expect(p.sentence).toContain("Labor looks incomplete for Glendale: only 2.2% of sales is on file as labor")

    const group = buildLaborPlain(
      week({ laborPct: 18, incomplete: [{ name: "Glendale", laborPct: 2.2 }], storeCount: 3 }),
    )
    expect(group.big.value).toBe("18.0%")
    expect(group.big.label).toContain("provisional")
    expect(group.statuses.map((s) => s.text)).toContain("Labor looks incomplete for Glendale")
  })

  it("names the clock leak, and has no share without sales", () => {
    const p = buildLaborPlain(week({ laborPct: null, leak: { hours: 6.5, cost: 120 } }))
    expect(p.big.value).toBeNull()
    expect(p.vs).toBeNull()
    expect(p.sentence).toContain("with no sales in this range to set it against")
    expect(p.sentence).toContain("Clock-in and clock-out alerts add up to 6.5 hours, about $120.")
  })
})
