// The commission rate a cash forecast charges against predicted revenue.
//
// It used to be `(uberRate + doordashRate) / 2` — two marketplace rates,
// averaged without reference to what each channel sold, then charged against
// every dollar the store took, in-house counter sales included.

import { describe, it, expect } from "vitest"
import { weightedCommissionRate } from "@/lib/commission-blend"

const store = (id: string, uber: number | null, dd: number | null) => ({
  id,
  uberCommissionRate: uber,
  doordashCommissionRate: dd,
})

describe("weightedCommissionRate", () => {
  it("dilutes the rate across sales that pay no commission", () => {
    // Half the trade is over the store's own counter. 21% and 25% average to
    // 23%, but the store pays 11.3% of its total revenue away.
    const rate = weightedCommissionRate(
      [store("s1", 0.21, 0.25)],
      [
        { storeId: "s1", platform: "css-pos", net: 5000 },
        { storeId: "s1", platform: "ubereats", net: 3000 },
        { storeId: "s1", platform: "doordash", net: 2000 },
      ],
    )
    expect(rate).toBeCloseTo(0.113, 10)
  })

  it("weights by what each channel actually sold", () => {
    const rate = weightedCommissionRate(
      [store("s1", 0.2, 0.3)],
      [
        { storeId: "s1", platform: "ubereats", net: 9000 },
        { storeId: "s1", platform: "doordash", net: 1000 },
      ],
    )
    expect(rate).toBeCloseTo(0.21, 10)
  })

  it("applies each store's own rate to that store's own sales", () => {
    // A mean of per-store rates gives 25%. The account actually pays 21%,
    // because the store on the bad deal is the small one.
    const rate = weightedCommissionRate(
      [store("big", 0.2, 0.2), store("small", 0.3, 0.3)],
      [
        { storeId: "big", platform: "ubereats", net: 9000 },
        { storeId: "small", platform: "ubereats", net: 1000 },
      ],
    )
    expect(rate).toBeCloseTo(0.21, 10)
  })

  it("leaves an uncommissioned marketplace in the denominator only", () => {
    // Grubhub has no rate column and Otter publishes no commission row for
    // it — the same convention channel-series.ts applies.
    const rate = weightedCommissionRate(
      [store("s1", 0.2, 0.2)],
      [
        { storeId: "s1", platform: "ubereats", net: 5000 },
        { storeId: "s1", platform: "grubhub", net: 5000 },
      ],
    )
    expect(rate).toBeCloseTo(0.1, 10)
  })

  it("treats an unset rate as unmeasured, not as zero commission on zero sales", () => {
    const rate = weightedCommissionRate(
      [store("s1", null, 0.25)],
      [
        { storeId: "s1", platform: "ubereats", net: 5000 },
        { storeId: "s1", platform: "doordash", net: 5000 },
      ],
    )
    // Uber's sales stay in the denominator; only its commission is unknown.
    expect(rate).toBeCloseTo(0.125, 10)
  })

  it("returns null rather than 0 when nothing sold", () => {
    expect(weightedCommissionRate([store("s1", 0.2, 0.2)], [])).toBeNull()
    expect(
      weightedCommissionRate(
        [store("s1", 0.2, 0.2)],
        [{ storeId: "s1", platform: "ubereats", net: 0 }],
      ),
    ).toBeNull()
  })

  it("ignores sales from a store outside the rate set", () => {
    const rate = weightedCommissionRate(
      [store("s1", 0.2, 0.2)],
      [
        { storeId: "s1", platform: "ubereats", net: 5000 },
        { storeId: "stranger", platform: "ubereats", net: 5000 },
      ],
    )
    // The stranger's sales count as revenue with no rate to charge, the same
    // as Grubhub. They are not silently given s1's rate.
    expect(rate).toBeCloseTo(0.1, 10)
  })
})
