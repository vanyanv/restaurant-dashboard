// The verdict line is the one sentence the page leads with, so it is the one
// sentence that must never be wrong. These tests pin the deterministic
// composer — which is what renders whenever the LLM is unavailable, fails, or
// returns something the guard rejects — and the fact block, which is the single
// source both the prompt and the anti-hallucination allowlist are built from.

import { describe, it, expect } from "vitest"
import {
  buildVerdictFacts,
  composeVerdict,
  verdictFactBlock,
  splitVerdictChunks,
  verdictInputsHash,
  verdictSources,
  type VerdictFacts,
} from "@/app/dashboard/(editorial)/decisions/lib/verdict-copy"

const facts = (over: Partial<VerdictFacts> = {}): VerdictFacts => ({
  storeName: "Hollywood",
  isAggregate: false,
  weekTotal: 56000,
  weekP10: 49000,
  weekP90: 63000,
  peakDay: { weekdayShort: "SAT", predictedRevenue: 9240 },
  laborGapHours: -11,
  laborStatus: "short",
  shortDays: 2,
  unscheduledDays: 0,
  topAction: { title: "Reprice the Double Slider", impactUsdPerWeek: 640 },
  potUsdPerWeek: 2140,
  accuracyWape: 0.064,
  accuracySample: 26,
  topBriefing: null,
  ...over,
})

describe("buildVerdictFacts", () => {
  it("takes the week's busiest day as the peak", () => {
    const f = buildVerdictFacts({
      storeName: "Hollywood",
      isAggregate: false,
      days: [
        { weekdayShort: "MON", predictedRevenue: 5000 },
        { weekdayShort: "SAT", predictedRevenue: 9240 },
        { weekdayShort: "SUN", predictedRevenue: 7100 },
      ],
      vitals: {
        weekForecast: { total: 21340, p10: null, p90: null, daysCounted: 3, vsPriorWeek: null },
        laborGap: {
          hours: -11,
          status: "short",
          shortDays: 2,
          heavyDays: 0,
          unscheduledDays: 0,
          unfilledSlots: 0,
        },
        splh: { actual: null, target: null, status: "unknown" },
        accuracy: { wape: 0.064, beatsBaselineBy: 0.31, sampleSize: 26 },
      },
      actions: [{ title: "Reprice the Double Slider", impactUsdPerWeek: 640 }],
      potUsdPerWeek: 2140,
    })
    expect(f.peakDay).toEqual({ weekdayShort: "SAT", predictedRevenue: 9240 })
    expect(f.topAction?.impactUsdPerWeek).toBe(640)
  })

  it("has no peak day when the week is empty", () => {
    const f = buildVerdictFacts({
      storeName: "Hollywood",
      isAggregate: false,
      days: [],
      vitals: {
        weekForecast: { total: null, p10: null, p90: null, daysCounted: 0, vsPriorWeek: null },
        laborGap: {
          hours: null,
          status: "unknown",
          shortDays: 0,
          heavyDays: 0,
          unscheduledDays: 0,
          unfilledSlots: 0,
        },
        splh: { actual: null, target: null, status: "unknown" },
        accuracy: null,
      },
      actions: [],
      potUsdPerWeek: 0,
    })
    expect(f.peakDay).toBeNull()
    expect(f.topAction).toBeNull()
  })
})

describe("verdictFactBlock", () => {
  it("formats every figure the narration is allowed to quote", () => {
    const block = verdictFactBlock(facts())
    expect(block.week_forecast).toBe("$56,000")
    expect(block.peak_day).toBe("SAT")
    expect(block.peak_day_forecast).toBe("$9,240")
    expect(block.labor_gap_hours).toBe("11")
    expect(block.top_action_impact).toBe("$640")
  })

  it("omits keys the data doesn't support rather than emitting a placeholder", () => {
    const block = verdictFactBlock(
      facts({ weekTotal: null, peakDay: null, accuracyWape: null, accuracySample: 0 }),
    )
    expect(block.week_forecast).toBeUndefined()
    expect(block.peak_day).toBeUndefined()
    expect(block.forecast_accuracy).toBeUndefined()
  })

  it("states the labor gap as a magnitude, with direction in its own key", () => {
    const block = verdictFactBlock(facts({ laborGapHours: -11, laborStatus: "short" }))
    expect(block.labor_gap_hours).toBe("11")
    expect(block.labor_direction).toBe("short")
  })
})

describe("composeVerdict", () => {
  it("leads with the peak day and the labor gap when the week is short", () => {
    const line = composeVerdict(facts())
    expect(line).toContain("SAT")
    expect(line).toContain("$9,240")
    expect(line).toContain("11 hours short")
  })

  it("leads with the pot when labor is level", () => {
    const line = composeVerdict(facts({ laborStatus: "level", laborGapHours: -3, shortDays: 0 }))
    expect(line).toContain("$2,140")
    expect(line).not.toContain("short")
  })

  it("says the schedule is missing rather than inventing a gap", () => {
    const line = composeVerdict(
      facts({ laborStatus: "unknown", laborGapHours: null, shortDays: 0, unscheduledDays: 7 }),
    )
    expect(line.toLowerCase()).toContain("no schedule")
  })

  it("admits when there is no forecast at all", () => {
    const line = composeVerdict(
      facts({
        weekTotal: null,
        weekP10: null,
        weekP90: null,
        peakDay: null,
        topAction: null,
        potUsdPerWeek: 0,
      }),
    )
    expect(line.toLowerCase()).toContain("no forecast")
  })

  it("never trails a sentence fragment", () => {
    for (const f of [
      facts(),
      facts({ laborStatus: "level" }),
      facts({ topAction: null, potUsdPerWeek: 0 }),
      facts({ weekTotal: null, peakDay: null }),
    ]) {
      expect(composeVerdict(f).trim()).toMatch(/[.!?]$/)
    }
  })
})

describe("composeVerdict — the absorbed briefing line", () => {
  const NOTE = "Cash dips below $4,000 on Thursday."

  // page.tsx drops briefing[0] from the list on the assumption the verdict
  // carries it. If the composer ignored it, that line would vanish entirely
  // whenever the narrator is unavailable.
  it("leads with the top briefing line when there is one", () => {
    expect(composeVerdict(facts({ topBriefing: NOTE }))).toBe(NOTE)
  })

  it("falls back to the computed reading when the line is too long to set", () => {
    const long = `${"Cash is tight and the week is heavy ".repeat(8)}.`
    const line = composeVerdict(facts({ topBriefing: long }))
    expect(line).not.toBe(long)
    expect(line).toContain("SAT")
  })

  it("puts the line's own figures on the narration allowlist", () => {
    const block = verdictFactBlock(facts({ topBriefing: NOTE }))
    expect(block.headline_note).toBe(NOTE)
  })
})

describe("verdictSources", () => {
  it("names the forecast and the schedule it read", () => {
    const s = verdictSources(facts())
    expect(s.join(" · ")).toContain("REVENUE FORECAST")
    expect(s.join(" · ")).toContain("HARRI SCHEDULE")
  })

  it("cites the reconciled sample when the model has a track record", () => {
    expect(verdictSources(facts()).join(" · ")).toContain("26 RECONCILED DAYS")
  })

  it("drops the schedule citation when nothing was published", () => {
    const s = verdictSources(facts({ laborStatus: "unknown", unscheduledDays: 7 }))
    expect(s.join(" · ")).not.toContain("HARRI SCHEDULE")
  })
})

describe("verdictInputsHash", () => {
  it("is stable across calls with the same facts", () => {
    expect(verdictInputsHash(facts())).toBe(verdictInputsHash(facts()))
  })

  it("moves when a displayed figure moves", () => {
    expect(verdictInputsHash(facts())).not.toBe(
      verdictInputsHash(facts({ weekTotal: 57000 })),
    )
  })

  // The cache exists to bound API spend. A float wobbling in a decimal place
  // the page never renders must not buy a new sentence.
  it("holds steady when a change rounds away before display", () => {
    expect(verdictInputsHash(facts({ weekTotal: 56000 }))).toBe(
      verdictInputsHash(facts({ weekTotal: 56000.4 })),
    )
  })

  it("moves when the labor direction flips without changing magnitude", () => {
    expect(verdictInputsHash(facts({ laborGapHours: -11, laborStatus: "short" }))).not.toBe(
      verdictInputsHash(facts({ laborGapHours: 11, laborStatus: "heavy" })),
    )
  })
})

// Tripwire #2: Fraunces italic is prose and display only. A Fraunces-italic
// dollar amount fails the system, so the figures have to be liftable out of the
// sentence and set in DM Sans tabular.
describe("splitVerdictChunks", () => {
  it("lifts a currency figure out whole, dollar sign included", () => {
    expect(splitVerdictChunks("SAT carries $9,240 today.")).toEqual([
      { kind: "text", value: "SAT carries ", flagged: false },
      { kind: "num", value: "$9,240", flagged: false },
      { kind: "text", value: " today.", flagged: false },
    ])
  })

  it("keeps a percent sign with its figure", () => {
    const chunks = splitVerdictChunks("The model misses by 6.4% on average.")
    expect(chunks.find((c) => c.kind === "num")?.value).toBe("6.4%")
  })

  it("handles several figures in one sentence", () => {
    const nums = splitVerdictChunks("SAT is $9,240 and you are 11 hours short.")
      .filter((c) => c.kind === "num")
      .map((c) => c.value)
    expect(nums).toEqual(["$9,240", "11"])
  })

  it("passes a sentence with no figures through as one chunk", () => {
    expect(splitVerdictChunks("The schedule is thin.")).toEqual([
      { kind: "text", value: "The schedule is thin.", flagged: false },
    ])
  })

  // Reassembly must be lossless, or the masthead silently drops words.
  it("rejoins to exactly the original line", () => {
    for (const line of [
      "SAT is the week's biggest day at $9,240, and you are 11 hours short on the schedule.",
      "No forecast for Hollywood this week yet.",
      "$2,140 a week is sitting in actions you haven't called yet.",
    ]) {
      expect(splitVerdictChunks(line).map((c) => c.value).join("")).toBe(line)
    }
  })
})

// The concept sets "11 hours short" in accent so the sentence has a subject.
// Live couldn't: the narrator returns plain prose and nothing marked a clause.
// The rule lives here rather than in the prompt — principle #7 does not let the
// model decide anything about the page, emphasis included.
describe("splitVerdictChunks — the flagged clause", () => {
  const joined = (cs: ReturnType<typeof splitVerdictChunks>) =>
    cs.filter((c) => c.flagged).map((c) => c.value).join("")

  it("flags nothing unless the week is actually short", () => {
    const cs = splitVerdictChunks("You are 11 hours short on the line.", false)
    expect(cs.every((c) => !c.flagged)).toBe(true)
  })

  it("flags the clause the owner has to act on", () => {
    expect(joined(splitVerdictChunks("SAT carries $9,240 and you are 11 hours short.", true)))
      .toBe("11 hours short")
  })

  it("carries the rest of the clause with it", () => {
    expect(joined(splitVerdictChunks("You are 11.2 hours short on the line today.", true)))
      .toBe("11.2 hours short on the line today")
  })

  it("flags an overstaffed clause too", () => {
    expect(joined(splitVerdictChunks("The schedule runs 22 hours over what it earns.", true)))
      .toBe("22 hours over what it earns")
  })

  it("flags the narrator's phrasing as well as the composer's", () => {
    expect(joined(splitVerdictChunks("This week peaks on SAT, a labor gap of 11.2 hours.", true)))
      .toBe("a labor gap of 11.2 hours")
  })

  // Tripwire #2: Fraunces never sets a number, red or otherwise. A flagged
  // clause must still hand its figure to the sans chunk.
  it("keeps the figure inside a flagged clause in its own num chunk", () => {
    const cs = splitVerdictChunks("You are 11 hours short.", true)
    const num = cs.find((c) => c.kind === "num")
    expect(num).toEqual({ kind: "num", value: "11", flagged: true })
  })

  it("reassembles the original sentence exactly, flagged or not", () => {
    for (const line of [
      "SAT carries $9,240 and you are 11 hours short.",
      "The schedule runs 22 hours over what it earns.",
      "Nothing numeric here at all.",
      "This week peaks on SAT, a labor gap of 11.2 hours to level.",
    ]) {
      for (const flag of [true, false]) {
        expect(splitVerdictChunks(line, flag).map((c) => c.value).join("")).toBe(line)
      }
    }
  })

  it("never emits an empty chunk", () => {
    const cs = splitVerdictChunks("11 hours short.", true)
    expect(cs.every((c) => c.value.length > 0)).toBe(true)
  })
})
