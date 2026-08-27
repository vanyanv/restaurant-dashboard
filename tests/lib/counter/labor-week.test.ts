// laborDay / laborWeek / laborRole / laborTrendWeek — the labour week's pure
// arithmetic, against "The measured data" in
// .superpowers/sdd/2026-08-27-counter-labor-fidelity/task-1-brief.md and the
// CORRECTED sales-per-labour-hour table in that plan's task-1b-brief.md,
// window 2026-08-20 … 2026-08-26, Hollywood.
//
// Dollar figures there are a snapshot (the Otter sync backfills closed
// windows); ratios are the contract. Per-day dollar figures are not
// published at cent precision, so this fixture RECONSTRUCTS them:
//   - cost: the seven whole-dollar day figures, with the leftover 47c parked
//     on the last day so the range total is exactly $8,825.47.
//   - platformSales (SPLH's sales): the seven measured NET SALES figures off
//     `OtterHourlySummary`, from task-1b-brief.md's corrected table — an
//     INDEPENDENT input, never derived from the expected SPLH. Task 1's
//     original fixture built this as `splh * actualHours`, which fed the
//     expected answer into the input and could not fail regardless of which
//     sales source (gross vs. net) the code actually read — the defect
//     task-1b exists to close. Because these net-sales figures are quoted to
//     the whole dollar and the hours to 0.1h, the SPLH computed from them
//     lands a few cents from task-1b's own rounded per-day SPLH column;
//     assertions below use a tolerance wide enough to absorb that.
//   - totalSales (laborPct's sales): NOT published per day — only the range
//     total ($49,389) and the resulting 17.9% are. Seven placeholder day
//     figures are used that sum to exactly $49,389; their individual split
//     is invented and asserted nowhere.
import { describe, it, expect, vi } from "vitest"

// `labor-week.ts` imports `@/lib/prisma` for its two loaders. That import
// throws without `DATABASE_URL` at MODULE LOAD. This file never calls
// `loadLaborWeek`/`loadLaborTrend` (loaders are not unit-tested, per this
// task's rule — no mocked Prisma) — the mock only keeps the import graph
// from crashing at load time, same pattern as
// `tests/lib/counter/service-profile.test.ts`.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { laborDay, laborRole, laborTrendWeek, laborWeek, type LaborDay } from "@/lib/counter/labor-week"

/* ── The measured window, 2026-08-20 … 2026-08-26 ────────────────────── */

const ACTUAL_HOURS = [56.8, 66.5, 60.7, 66.1, 59.6, 59.4, 63.0]
const SCHEDULED_HOURS = [59.0, 69.5, 70.0, 67.5, 58.5, 48.5, 64.0]
const COST = [1181, 1356, 1245, 1349, 1195, 1222, 1277.47]
// NET SALES off `OtterHourlySummary`, task-1b-brief.md's corrected per-day
// table — measured independently of SPLH (this IS the app's real sales
// figure for the day, not an inversion of the ratio under test). Sums to
// $52,551 against the brief's rounder $52,550 range total — a whole-dollar
// rounding artifact of the seven inputs, not a fixture error.
const NET_SALES = [6883, 7685, 8307, 9345, 7522, 6358, 6451]
// The corrected per-day SPLH the brief measured (net sales / actual hours),
// kept here ONLY as the assertions' target values below — never fed back in
// as an input. A day's `NET_SALES[i] / ACTUAL_HOURS[i]` lands a few cents
// from these because both dollars and hours are quoted rounded.
const SPLH_MEASURED = [121.10, 115.59, 136.78, 141.45, 126.27, 106.97, 102.34]
// Total Sales per day: NOT published individually — only the range total
// ($49,389) and its 17.9% are measured. These seven figures are invented to
// sum to exactly that total; no single day's laborPct is asserted against
// them.
const TOTAL_SALES = [7000, 7000, 7000, 7100, 7000, 7000, 7289]
const KEYS = [
  "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24",
  "2026-08-25", "2026-08-26",
]

function buildWeek(): LaborDay[] {
  return KEYS.map((key, i) =>
    laborDay({
      key,
      label: key,
      actualSeconds: ACTUAL_HOURS[i] * 3600,
      scheduledMinutes: SCHEDULED_HOURS[i] * 60,
      cost: COST[i],
      platformSales: NET_SALES[i],
      totalSales: TOTAL_SALES[i],
    }),
  )
}

describe("laborWeek — the measured window", () => {
  it("sums actual hours, scheduled hours and cost", () => {
    const week = laborWeek(buildWeek(), 51.08)
    expect(week.actualHours).toBeCloseTo(432.1, 1)
    expect(week.scheduledHours).toBeCloseTo(437.0, 1)
    expect(week.cost).toBeCloseTo(8825.47, 2)
  })

  it("blends cost over hours at $20.42/h", () => {
    const week = laborWeek(buildWeek(), 51.08)
    expect(week.blendedRate).toBeCloseTo(20.42, 2)
  })

  it("takes splh over NET platform sales at $121.60 for the range — not gross's $158.76", () => {
    const week = laborWeek(buildWeek(), 51.08)
    // $121.60 is `OtterHourlySummary.netSales` over the window — the figure
    // `getSplhSeries`/the Overview page already print. $158.76 (task 1's
    // original, wrong, target) was computed from `OtterDailySummary` GROSS
    // and is ruled out explicitly below so a regression back to a gross
    // source fails loudly instead of by coincidence.
    expect(week.splh).toBeCloseTo(121.6, 1)
    expect(week.splh as number).not.toBeCloseTo(158.76, 0)
  })

  it("takes each day's own splh — ~$141 on 08-23, ~$102 on 08-26", () => {
    const week = laborWeek(buildWeek(), 51.08)
    const aug23 = week.days.find((d) => d.key === "2026-08-23")
    const aug26 = week.days.find((d) => d.key === "2026-08-26")
    // Precision 0 (not 2): the input here is real net sales quoted to the
    // whole dollar over hours quoted to 0.1h, so it lands a few cents from
    // task-1b-brief.md's own rounded SPLH column ($141.45 / $102.34) — see
    // the fixture-precision note at the top of this file.
    expect(aug23?.splh).toBeCloseTo(SPLH_MEASURED[3], 0)
    expect(aug26?.splh).toBeCloseTo(SPLH_MEASURED[6], 0)
  })

  it("takes laborPct over TOTAL SALES (17.9%) — never the platform-sales denominator (12.9%)", () => {
    const week = laborWeek(buildWeek(), 51.08)
    // The right answer.
    expect(week.laborPct).not.toBeNull()
    expect(week.laborPct as number).toBeCloseTo(17.9, 1)
    // The wrong one, ruled out explicitly. $8,825.47 over the SAME window's
    // platform sales (SPLH's sales figure, ~$68.6k here) reads 12.9%, not
    // 17.9% — the exact defect L-R2 exists to close. If `laborWeek` ever
    // starts computing `laborPct` off platform sales instead of Total Sales,
    // this line is the one that catches it.
    expect(week.laborPct as number).not.toBeCloseTo(12.9, 1)
  })

  it("carries overtimeCost straight through", () => {
    const week = laborWeek(buildWeek(), 51.08)
    expect(week.overtimeCost).toBe(51.08)
  })
})

describe("laborDay — nulls, not zeros", () => {
  it("yields splh: null for a day with hours and no platform sales", () => {
    const day = laborDay({
      key: "2026-09-01",
      label: "Tue Sep 1",
      actualSeconds: 8 * 3600,
      scheduledMinutes: 8 * 60,
      cost: 200,
      platformSales: null,
      totalSales: 500,
    })
    expect(day.splh).toBeNull()
    expect(day.actualHours).toBe(8)
  })

  it("yields splh: null for a day with zero hours, even with sales", () => {
    const day = laborDay({
      key: "2026-09-02",
      label: "Wed Sep 2",
      actualSeconds: 0,
      scheduledMinutes: null,
      cost: 0,
      platformSales: 400,
      totalSales: 400,
    })
    expect(day.splh).toBeNull()
  })

  it("yields scheduledHours: null when no shift was published — not 0", () => {
    const day = laborDay({
      key: "2026-09-03",
      label: "Thu Sep 3",
      actualSeconds: 8 * 3600,
      scheduledMinutes: null,
      cost: 200,
      platformSales: 800,
      totalSales: 500,
    })
    expect(day.scheduledHours).toBeNull()
  })

  it("yields laborPct: null with no Total Sales — never 0", () => {
    const day = laborDay({
      key: "2026-09-04",
      label: "Fri Sep 4",
      actualSeconds: 8 * 3600,
      scheduledMinutes: 8 * 60,
      cost: 200,
      platformSales: 800,
      totalSales: null,
    })
    expect(day.laborPct).toBeNull()
  })
})

describe("laborRole — the salaried line is empty, not absent", () => {
  it("keeps a $0/0h SALARIED position, at share: 0, and sums shares to 100", () => {
    const roles = laborRole([
      { position: "Line Cook", payType: "HOURLY", hours: 1251, cost: 25777 },
      { position: "Cashier", payType: "HOURLY", hours: 575, cost: 11528 },
      { position: "Operator", payType: "SALARIED", hours: 0, cost: 0 },
    ])

    expect(roles).toHaveLength(3)
    const operator = roles.find((r) => r.position === "Operator")
    expect(operator).toBeDefined()
    expect(operator?.share).toBe(0)
    expect(operator?.hours).toBe(0)
    expect(operator?.cost).toBe(0)

    const shareSum = roles.reduce((a, r) => a + r.share, 0)
    expect(shareSum).toBeCloseTo(100, 2)
  })
})

// task 4b re-derivation: `laborPct` moved from platform sales to Total Sales,
// so the platform-sales percentages the ORIGINAL twelve-week table published
// (13.0% / 12.4%, both ruled out explicitly below) are no longer the right
// expectations. Total Sales for each week is measured independently — pulled
// live off `loadStatement`/`rowValues(TOTAL_SALES_CODE)` against the real
// database for these exact calendar weeks at Hollywood, the SAME construct
// `weeklySalesOf` in `adapters/labor.ts` folds into the trend — never
// inverted from an expected `laborPct`, which is exactly task 1's circular
// defect this file's own header warns about. `platformSales` (splh's input)
// is untouched and still independent of `totalSales`.
const NEWEST_TOTAL_SALES = 19973.6 // 2026-08-24..27 (partial), measured
const PRIOR_TOTAL_SALES = 49270.5 // 2026-08-17..23 (full week), measured

describe("laborTrendWeek — the running week is partial, the one before it isn't", () => {
  it("marks the newest (182h) week partial and the full 417h week before it not", () => {
    // 2026-08-24 (Mon) .. 2026-08-27 (Thu): the running week, clipped.
    // cost $3,695 / hours 182 / splh $155.60 (measured), split evenly across
    // 4 days for the fixture — no per-day figure is published or asserted.
    // `platformSales` is reconstructed from splh (splh's own input, unrelated
    // to `laborPct` since task 4b), so splh itself is never asserted below —
    // see the note on the "prior" week further down for why.
    const newestDays = Array.from({ length: 4 }, () => ({
      cost: 3695 / 4,
      hours: 182 / 4,
      platformSales: (155.6 * 182) / 4,
    }))
    const newest = laborTrendWeek(new Date(2026, 7, 24), true, newestDays, NEWEST_TOTAL_SALES)
    expect(newest.isPartial).toBe(true)
    expect(newest.hours).toBeCloseTo(182, 0)
    expect(newest.cost).toBeCloseTo(3695, 0)
    // Total Sales (task 4b) — $3,695 / $19,973.60 measured, not the
    // platform-sales 13.0% the original (pre-fix) table read for this week.
    expect(newest.laborPct as number).toBeCloseTo(18.5, 1)
    expect(newest.laborPct as number).not.toBeCloseTo(13.0, 1)

    // 2026-08-17 (Mon) .. 2026-08-23 (Sun): a full week. The pre-4b
    // twelve-week table published only cost, hours, "% of platform sales" and
    // splh for this week — no independent net-sales figure for splh's input,
    // which is why `platformSales` below is still reconstructed from splh
    // (the more precise, cents-quoted figure) rather than independently
    // measured: asserting splh after building `platformSales` as
    // `splh * hours` would be task 1's circular defect (feed the answer in,
    // get the answer out), so splh itself is never asserted. `totalSales`
    // carries no such problem — it is `laborPct`'s ONLY input now, measured
    // independently (see above), so `laborPct` IS asserted, directly against
    // the live figure.
    const priorDays = Array.from({ length: 7 }, () => ({
      cost: 8500 / 7,
      hours: 417 / 7,
      platformSales: 68688.24 / 7,
    }))
    const prior = laborTrendWeek(new Date(2026, 7, 17), false, priorDays, PRIOR_TOTAL_SALES)
    expect(prior.isPartial).toBe(false)
    expect(prior.hours).toBeCloseTo(417, 0)
    expect(prior.cost).toBeCloseTo(8500, 0)
    // Total Sales (task 4b) — $8,500 / $49,270.50 measured, not the
    // platform-sales 12.4% the original (pre-fix) table read for this week.
    expect(prior.laborPct as number).toBeCloseTo(17.3, 1)
    expect(prior.laborPct as number).not.toBeCloseTo(12.4, 1)
  })

  it("agrees with the headline's OWN laborPct construction for the same week — the invariant task 4b exists to establish", () => {
    // This is L-R2's whole point, made concrete: the trend's laborPct and the
    // headline's laborPct must be the SAME division of the SAME two numbers
    // for the same week, not two different sales figures that happen to be
    // close. Built two ways from the identical cost/hours/Total-Sales inputs
    // (2026-08-17..23, measured) — once through `laborTrendWeek` (the trend's
    // own construction) and once through `laborDay`/`laborWeek` (the
    // headline's own construction, `LaborWeek.laborPct`) — and asserted equal.
    // Before task 4b this failed by five points (17.9% vs 12.9%, per the
    // brief); it can only pass now because both paths call the same
    // `pctOfSales(cost, totalSales)` underneath.
    const cost = 8500.275
    const hours = 417
    const totalSales = PRIOR_TOTAL_SALES

    const trendDays = Array.from({ length: 7 }, () => ({
      cost: cost / 7,
      hours: hours / 7,
      platformSales: 68688.24 / 7,
    }))
    const trendWeek = laborTrendWeek(new Date(2026, 7, 17), false, trendDays, totalSales)

    const priorKeys = [
      "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20",
      "2026-08-21", "2026-08-22", "2026-08-23",
    ]
    const headlineDays: LaborDay[] = priorKeys.map((key) =>
      laborDay({
        key,
        label: key,
        actualSeconds: (hours / 7) * 3600,
        scheduledMinutes: null,
        cost: cost / 7,
        platformSales: null,
        totalSales: totalSales / 7,
      }),
    )
    const headlineWeek = laborWeek(headlineDays, 0)

    expect(trendWeek.laborPct).not.toBeNull()
    expect(headlineWeek.laborPct).not.toBeNull()
    expect(trendWeek.laborPct as number).toBeCloseTo(headlineWeek.laborPct as number, 6)
  })
})
