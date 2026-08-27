import { describe, it, expect } from "vitest"
import { newestGenerationPerDay } from "@/lib/counter/forecast-generation"

const row = (date: string, gen: string, predicted: number, storeId = "s1") => ({
  storeId,
  forecastDate: new Date(`${date}T00:00:00Z`),
  generatedAt: new Date(gen),
  predictedRevenue: predicted,
})

describe("newestGenerationPerDay", () => {
  it("keeps one row per store-day — the newest generation", () => {
    const out = newestGenerationPerDay([
      row("2026-08-26", "2026-08-24T10:42:00Z", 6238),
      row("2026-08-26", "2026-08-26T10:41:00Z", 6269),
      row("2026-08-26", "2026-08-25T10:39:00Z", 6301),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].predictedRevenue).toBe(6269)
  })

  /*
   * The measurement this function exists for. Sixteen generations wrote the
   * same fortnight; the seven-day total is $50,754 deduped and $646,442 raw.
   * A test that only checked "returns fewer rows" would pass against a
   * function that dropped the wrong ones.
   */
  it("turns many generations into the newest one's total, not their sum", () => {
    const rows = []
    for (let day = 26; day <= 30; day++) {
      for (let g = 0; g < 12; g++) {
        rows.push(
          row(
            `2026-08-${day}`,
            `2026-08-${String(14 + g).padStart(2, "0")}T10:00:00Z`,
            1000 + g, // the newest generation is g=11 -> 1011
          ),
        )
      }
    }
    const total = newestGenerationPerDay(rows).reduce((a, r) => a + r.predictedRevenue, 0)
    expect(total).toBe(5 * 1011)
    // and emphatically not the raw sum
    expect(rows.reduce((a, r) => a + r.predictedRevenue, 0)).toBe(5 * 12 * 1000 + 5 * 66)
  })

  it("does not merge two stores on the same day", () => {
    const out = newestGenerationPerDay([
      row("2026-08-26", "2026-08-26T10:41:00Z", 6269, "hollywood"),
      row("2026-08-26", "2026-08-26T10:41:00Z", 40, "glendale"),
    ])
    expect(out).toHaveLength(2)
    expect(out.reduce((a, r) => a + r.predictedRevenue, 0)).toBe(6309)
  })

  // Rows arrive from Prisma in whatever order the caller asked for. The
  // function must not depend on that — a caller who forgets `orderBy` gets the
  // same answer, or this is just an assertion about the query.
  it("does not depend on input order", () => {
    const a = row("2026-08-26", "2026-08-26T10:41:00Z", 6269)
    const b = row("2026-08-26", "2026-08-20T10:41:00Z", 5900)
    expect(newestGenerationPerDay([a, b])[0].predictedRevenue).toBe(6269)
    expect(newestGenerationPerDay([b, a])[0].predictedRevenue).toBe(6269)
  })

  it("returns days in ascending date order whatever it was given", () => {
    const out = newestGenerationPerDay([
      row("2026-08-28", "2026-08-26T10:41:00Z", 7312),
      row("2026-08-26", "2026-08-26T10:41:00Z", 6269),
      row("2026-08-27", "2026-08-26T10:41:00Z", 6456),
    ])
    expect(out.map((r) => r.predictedRevenue)).toEqual([6269, 6456, 7312])
  })

  it("returns an empty array unchanged", () => {
    expect(newestGenerationPerDay([])).toEqual([])
  })

  // Two rows written in the same millisecond is not hypothetical — the nightly
  // writes a whole fortnight at one `generatedAt`. Within one store-day it
  // should still collapse to one row rather than returning both.
  it("collapses a tie to a single row", () => {
    const out = newestGenerationPerDay([
      row("2026-08-26", "2026-08-26T10:41:00Z", 6269),
      row("2026-08-26", "2026-08-26T10:41:00Z", 6270),
    ])
    expect(out).toHaveLength(1)
  })
})
