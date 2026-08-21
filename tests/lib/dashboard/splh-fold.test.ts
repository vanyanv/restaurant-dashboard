import { describe, it, expect } from "vitest"
import { foldSplhSeries } from "@/lib/dashboard/splh-fold"
import type { SplhPoint } from "@/lib/splh"

function pt(over: Partial<SplhPoint> & { date: string }): SplhPoint {
  return {
    label: over.date.slice(5),
    weekday: 3,
    netSales: 0,
    laborHours: 0,
    splh: null,
    targetSplh: null,
    earnedHours: null,
    varianceHours: null,
    varianceDollars: null,
    status: "ok" as SplhPoint["status"],
    ...over,
  }
}

describe("foldSplhSeries", () => {
  it("returns nothing for no series", () => {
    expect(foldSplhSeries([])).toEqual([])
  })

  it("passes a single store's points through untouched", () => {
    const points = [pt({ date: "2026-08-19", netSales: 6263, laborHours: 52, splh: 120.4 })]
    expect(foldSplhSeries([{ points }])).toBe(points)
  })

  it("recomputes the ratio from summed sales and hours, not by averaging ratios", () => {
    // A store trading $2,000 over 40 hours ($50/hr) and one trading $900 over
    // 5 hours ($180/hr). The mean of the ratios is $115; the true combined
    // figure is 2900/45 = $64.44.
    const folded = foldSplhSeries([
      { points: [pt({ date: "2026-08-19", netSales: 2000, laborHours: 40, splh: 50 })] },
      { points: [pt({ date: "2026-08-19", netSales: 900, laborHours: 5, splh: 180 })] },
    ])
    expect(folded).toHaveLength(1)
    expect(folded[0].splh).toBeCloseTo(2900 / 45, 6)
    expect(folded[0].netSales).toBe(2900)
    expect(folded[0].laborHours).toBe(45)
  })

  it("sums variance dollars across stores", () => {
    const folded = foldSplhSeries([
      { points: [pt({ date: "2026-08-19", netSales: 100, laborHours: 2, varianceDollars: 120 })] },
      { points: [pt({ date: "2026-08-19", netSales: 100, laborHours: 2, varianceDollars: 80 })] },
    ])
    expect(folded[0].varianceDollars).toBe(200)
  })

  it("takes the median target rather than summing targets", () => {
    const folded = foldSplhSeries([
      { points: [pt({ date: "2026-08-19", netSales: 1, laborHours: 1, targetSplh: 60 })] },
      { points: [pt({ date: "2026-08-19", netSales: 1, laborHours: 1, targetSplh: 80 })] },
      { points: [pt({ date: "2026-08-19", netSales: 1, laborHours: 1, targetSplh: 70 })] },
    ])
    expect(folded[0].targetSplh).toBe(70)
  })

  it("leaves splh null when no hours posted", () => {
    const folded = foldSplhSeries([
      { points: [pt({ date: "2026-08-19", netSales: 500, laborHours: 0 })] },
      { points: [pt({ date: "2026-08-19", netSales: 300, laborHours: 0 })] },
    ])
    expect(folded[0].splh).toBeNull()
  })

  it("unions dates across stores and returns them in order", () => {
    const folded = foldSplhSeries([
      { points: [pt({ date: "2026-08-19", netSales: 10, laborHours: 1 })] },
      {
        points: [
          pt({ date: "2026-08-17", netSales: 10, laborHours: 1 }),
          pt({ date: "2026-08-18", netSales: 10, laborHours: 1 }),
        ],
      },
    ])
    expect(folded.map((p) => p.date)).toEqual([
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
    ])
  })
})
