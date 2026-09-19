// Does the gross-sales composition audit actually discriminate?
//
// `scripts/audit-gross-sales-composition.ts` settles two questions the
// 2026-09-19 calculation audit left open — whether Otter's gross sales are
// tax-inclusive, and whether service charges sit inside that figure — by
// asking which of four identities reconciles `gross` to `net` across every
// store-day we hold.
//
// A method like that is worth exactly as much as its ability to be WRONG. If
// every hypothesis scores well on any input, the script is a rubber stamp
// that will confirm whichever assumption the code already makes, which is the
// failure this whole exercise exists to avoid. So these tests build store-days
// under a KNOWN truth and assert that the matching identity wins and the
// others fail by the margin their missing term is worth.
//
// No database and no network: the scoring is pure arithmetic over rows.

import { describe, it, expect } from "vitest"

import {
  HYPOTHESES,
  score,
  impliedTaxRates,
  taxRateVerdict,
  type Row,
} from "../../scripts/audit-gross-sales-composition"

const TAX_RATE = 0.095

const byKey = (key: string) => {
  const h = HYPOTHESES.find((x) => x.key === key)
  if (!h) throw new Error(`no hypothesis ${key}`)
  return h
}

/**
 * A day of trading under a stated truth about what `gross` contains.
 *
 * `subtotal` is the menu price of what was sold. Discounts arrive signed
 * negative from Otter, so they are passed that way here rather than being
 * negated on use — the same convention `salesRowValues` documents.
 */
function day(opts: {
  subtotal: number
  discount?: number
  serviceCharges?: number
  fees?: number
  grossIncludesTax: boolean
  grossIncludesServiceCharges?: boolean
}): Row {
  const discount = opts.discount ?? 0
  const serviceCharges = opts.serviceCharges ?? 0
  const fees = opts.fees ?? 0
  const taxable = opts.subtotal + discount
  const tax = taxable * TAX_RATE

  let gross = opts.subtotal
  if (opts.grossIncludesTax) gross += tax
  if (opts.grossIncludesServiceCharges) gross += serviceCharges

  // Net is the takings after discounts, and never contains tax.
  const net = taxable

  return { gross, net, discounts: discount, tax, serviceCharges, fees }
}

/** Twenty days of varied trading, so a hit rate means something. */
function month(make: (i: number) => Row): Row[] {
  return Array.from({ length: 20 }, (_, i) => make(i))
}

describe("gross-sales composition — the method discriminates", () => {
  it("names a tax-inclusive gross when that is the truth", () => {
    const rows = month((i) =>
      day({ subtotal: 1000 + i * 37, discount: -(i * 5), grossIncludesTax: true }),
    )

    const inclusive = score(rows, byKey("gross-incl-tax"))
    const exclusive = score(rows, byKey("gross-excl-tax"))

    expect(inclusive.hitRate).toBe(1)
    expect(exclusive.hitRate).toBe(0)
  })

  it("names a tax-exclusive gross when THAT is the truth", () => {
    // The same test in the other direction. Without this one, a scorer that
    // simply preferred the longer formula would pass the test above.
    const rows = month((i) =>
      day({ subtotal: 1000 + i * 37, discount: -(i * 5), grossIncludesTax: false }),
    )

    const inclusive = score(rows, byKey("gross-incl-tax"))
    const exclusive = score(rows, byKey("gross-excl-tax"))

    expect(exclusive.hitRate).toBe(1)
    expect(inclusive.hitRate).toBe(0)
  })

  it("misses by the size of the term it got wrong, not by a rounding error", () => {
    // This is what makes the report readable: the losing identity's mean error
    // tells you WHAT it left out. A tax-inclusive gross scored as exclusive is
    // wrong by the tax, which is ~8.7% of a tax-inclusive gross (9.5% of the
    // subtotal, expressed over a gross that already carries it).
    const rows = month((i) => day({ subtotal: 1000 + i * 37, grossIncludesTax: true }))
    const exclusive = score(rows, byKey("gross-excl-tax"))

    const expected = TAX_RATE / (1 + TAX_RATE)
    expect(exclusive.meanAbsResidualPct).toBeCloseTo(expected, 4)
    // And it names the direction: predicting too high a net leaves a negative
    // residual, so the report can say which way the P&L is being moved.
    expect(exclusive.meanSignedResidualPct).toBeCloseTo(-expected, 4)
  })

  it("separates service charges sitting inside gross from service charges beside it", () => {
    // The 4040 line in `salesRowValues` ADDS service charges on top of gross.
    // If they were already inside it, Total Sales double-counts them — so the
    // script has to be able to tell those two worlds apart.
    const inside = month((i) =>
      day({
        subtotal: 1000 + i * 37,
        serviceCharges: 30 + i,
        grossIncludesTax: true,
        grossIncludesServiceCharges: true,
      }),
    )
    const beside = month((i) =>
      day({
        subtotal: 1000 + i * 37,
        serviceCharges: 30 + i,
        grossIncludesTax: true,
        grossIncludesServiceCharges: false,
      }),
    )

    expect(score(inside, byKey("gross-incl-tax-and-service")).hitRate).toBe(1)
    expect(score(inside, byKey("gross-incl-tax")).hitRate).toBe(0)

    expect(score(beside, byKey("gross-incl-tax")).hitRate).toBe(1)
    expect(score(beside, byKey("gross-incl-tax-and-service")).hitRate).toBe(0)
  })

  it("reports no hits at all when nothing describes the data", () => {
    // The outcome the script must be able to reach, or its verdict is
    // meaningless. Here net is unrelated to gross by any of the four
    // identities, and every one of them should say so rather than one of
    // them winning by being least wrong.
    const rows = month((i) => ({
      gross: 1000 + i * 37,
      net: 400 + i,
      discounts: 0,
      tax: 90,
      serviceCharges: 20,
      fees: -50,
    }))

    for (const h of HYPOTHESES) {
      expect(score(rows, h).hitRate).toBe(0)
    }
  })
})

describe("gross-sales composition — days that cannot speak", () => {
  it("skips a day with no takings rather than dividing by it", () => {
    // A closed day carries zeroes. Counting it as a hit would let a dead store
    // vote for every hypothesis equally and drag all four toward 100%.
    const rows: Row[] = [
      { gross: 0, net: 0, discounts: 0, tax: 0, serviceCharges: 0, fees: 0 },
      day({ subtotal: 1000, grossIncludesTax: true }),
    ]

    const s = score(rows, byKey("gross-incl-tax"))
    expect(s.rows).toBe(1)
    expect(Number.isFinite(s.meanAbsResidualPct)).toBe(true)
  })

  it("skips a fully refunded day, whose negative gross would invert the residual", () => {
    // The guard is `<= 0` rather than `=== 0` for the same reason `pctOfSales`
    // carries it: a negative denominator does not throw, it silently flips the
    // sign of the residual, and a wrong identity would then look right.
    const rows: Row[] = [
      { gross: -500, net: -500, discounts: 0, tax: 0, serviceCharges: 0, fees: 0 },
      day({ subtotal: 1000, grossIncludesTax: true }),
    ]

    expect(score(rows, byKey("gross-incl-tax")).rows).toBe(1)
  })

  it("returns zeroes rather than NaN when no day can speak", () => {
    const s = score([{ gross: 0, net: 0, discounts: 0, tax: 0, serviceCharges: 0, fees: 0 }], byKey("gross-incl-tax"))
    expect(s.rows).toBe(0)
    expect(s.hitRate).toBe(0)
    expect(Number.isNaN(s.meanAbsResidualPct)).toBe(false)
  })
})

/* ── The independent anchor ───────────────────────────────────────────── */

describe("gross-sales composition — the implied tax rate", () => {
  it("recovers the statutory rate from the true reading, under discounts", () => {
    // The whole point of the anchor is that it appeals to a number from
    // outside the data. It only works if discounts are taken out of the base:
    // tax is charged on what was sold, not on what was listed.
    const rows = month((i) =>
      day({ subtotal: 1000 + i * 13, discount: -(i * 2), grossIncludesTax: true }),
    )
    const rates = impliedTaxRates(rows)

    expect(rates.inclusive).toBeCloseTo(TAX_RATE, 6)
    expect(rates.exclusive).not.toBeCloseTo(TAX_RATE, 3)
    expect(taxRateVerdict(rates, TAX_RATE)).toBe("inclusive")
  })

  it("recovers it from the other reading too", () => {
    const rows = month((i) =>
      day({ subtotal: 800 + i * 11, discount: -(i * 3), grossIncludesTax: false }),
    )
    const rates = impliedTaxRates(rows)

    expect(rates.exclusive).toBeCloseTo(TAX_RATE, 6)
    expect(taxRateVerdict(rates, TAX_RATE)).toBe("exclusive")
  })

  it("does not call a tie when both readings sit inside a fixed window", () => {
    // The bug this replaced. On the tax-exclusive fixture the two implied
    // rates land about a point apart, straddling statutory; a "within one
    // point" test called that neither, while the right answer was sitting
    // exactly on the number. The verdict is comparative for this reason.
    const rows = month((i) => day({ subtotal: 800 + i * 11, discount: -(i * 3), grossIncludesTax: false }))
    const rates = impliedTaxRates(rows)

    const bothWithinAPoint =
      Math.abs((rates.inclusive as number) - TAX_RATE) < 0.01 &&
      Math.abs((rates.exclusive as number) - TAX_RATE) < 0.01
    expect(bothWithinAPoint).toBe(true)
    expect(taxRateVerdict(rates, TAX_RATE)).toBe("exclusive")
  })

  it("withholds a verdict when neither reading is near the rate", () => {
    // Reachable and meaningful: a jurisdiction whose rate was not the one
    // passed in, or a gross carrying non-taxable sales. Saying nothing is the
    // correct output, and the report tells the reader to go and look.
    const rows = month(() => ({
      gross: 1000,
      net: 1000,
      discounts: 0,
      tax: 10, // 1%, nothing like a sales tax
      serviceCharges: 0,
      fees: 0,
    }))
    expect(taxRateVerdict(impliedTaxRates(rows), TAX_RATE)).toBeNull()
  })

  it("returns null rather than a rate taken over a negative base", () => {
    // A base that has gone negative still divides, and the ratio it produces
    // is finite and merely sign-flipped — which reads as an answer.
    const rows: Row[] = [
      { gross: 100, net: 0, discounts: -300, tax: 20, serviceCharges: 0, fees: 0 },
    ]
    const rates = impliedTaxRates(rows)
    expect(rates.inclusive).toBeNull()
    expect(rates.exclusive).toBeNull()
    expect(taxRateVerdict(rates, TAX_RATE)).toBeNull()
  })
})
