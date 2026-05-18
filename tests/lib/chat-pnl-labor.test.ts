import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

import { buildLaborCaveats, type LaborCoverage } from "@/lib/chat/tools/pnl"

const cov = (overrides: Partial<LaborCoverage>): LaborCoverage => ({
  storeName: "Hollywood",
  totalDays: 30,
  coveredDays: 0,
  hasFixedMonthlyLabor: true,
  ...overrides,
})

describe("buildLaborCaveats", () => {
  it("returns no caveat when single store is fully covered", () => {
    expect(buildLaborCaveats([cov({ coveredDays: 30 })])).toEqual([])
  })

  it("returns no caveat when coverage >= 80%", () => {
    // 80% of 30 = 24
    expect(buildLaborCaveats([cov({ coveredDays: 24 })])).toEqual([])
  })

  it("emits per-store partial caveat when 0 < coverage < 80%", () => {
    const caveats = buildLaborCaveats([cov({ coveredDays: 18 })])
    expect(caveats).toHaveLength(1)
    expect(caveats[0]).toBe(
      "Labor for Hollywood: actual for 18/30 days, budgeted estimate for remainder.",
    )
  })

  it("emits combined no-actual caveat when coverage == 0 and fixed budget configured", () => {
    const caveats = buildLaborCaveats([cov({ coveredDays: 0 })])
    expect(caveats).toHaveLength(1)
    expect(caveats[0]).toBe(
      "Labor for Hollywood: fixed-monthly budget pro-rated by days, not actuals (no Harri data in this window).",
    )
  })

  it("combines multiple no-actual stores into one caveat", () => {
    const caveats = buildLaborCaveats([
      cov({ storeName: "GLN", coveredDays: 0 }),
      cov({ storeName: "VNYS", coveredDays: 0 }),
    ])
    expect(caveats).toHaveLength(1)
    expect(caveats[0]).toBe(
      "Labor for GLN, VNYS: fixed-monthly budget pro-rated by days, not actuals (no Harri data in this window).",
    )
  })

  it("multi-store mixed: only mentions stores that need a caveat", () => {
    // A fully covered, B partial, C no actuals
    const caveats = buildLaborCaveats([
      cov({ storeName: "Hollywood", coveredDays: 30 }),
      cov({ storeName: "GLN", coveredDays: 10 }),
      cov({ storeName: "VNYS", coveredDays: 0 }),
    ])
    expect(caveats).toHaveLength(2)
    expect(caveats).toContain(
      "Labor for GLN: actual for 10/30 days, budgeted estimate for remainder.",
    )
    expect(caveats).toContain(
      "Labor for VNYS: fixed-monthly budget pro-rated by days, not actuals (no Harri data in this window).",
    )
    // Hollywood (fully covered) is not mentioned.
    for (const c of caveats) expect(c).not.toContain("Hollywood")
  })

  it("skips no-actual stores that have no fixed budget configured (handled by existing laborMissing caveat)", () => {
    const caveats = buildLaborCaveats([
      cov({ storeName: "GLN", coveredDays: 0, hasFixedMonthlyLabor: false }),
    ])
    expect(caveats).toEqual([])
  })

  it("treats totalDays==0 as not-needing-caveat (defensive)", () => {
    expect(buildLaborCaveats([cov({ totalDays: 0, coveredDays: 0 })])).toEqual([])
  })
})
