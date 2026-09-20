// Does the gross-sales composition audit actually discriminate?
//
// `scripts/audit-gross-sales-composition.ts` settles two questions the
// 2026-09-19 calculation audit left open — whether Otter's gross sales carry
// tax, and whether they carry service charges — by asking which combination
// of five in-or-out components reconciles `gross` to `net` across every
// store-day slice.
//
// A method like that is worth exactly as much as its ability to be WRONG. If
// every reading scores well on any input, it is a rubber stamp that will
// confirm whichever assumption the code already makes, which is the failure
// this exercise exists to avoid. So these build slices under a KNOWN truth
// and assert that the matching reading wins, that the opposite one loses, and
// that the method says nothing when nothing fits.
//
// Two of these tests exist because a review caught the suite passing while
// the code was wrong:
//
//   The fees formula was completely unconstrained. Flipping its sign left all
//   thirteen tests green, because no fixture ever set a fee. A term whose sign
//   depends on a convention needs a fixture that would notice the convention
//   being broken.
//
//   Every fixture was twenty scaled copies of one kind of day. Every identity
//   here is linear and scale-free, so twenty of those carry exactly as much
//   discriminating power as one. `month()` now varies the KIND of day.
//
// No database and no network: the scoring is pure arithmetic over rows.

import { describe, it, expect } from "vitest"

import {
  TERMS,
  allCompositions,
  bestComposition,
  decideTerm,
  impliedTaxRates,
  isMaterial,
  leftover,
  scoreComposition,
  signProfile,
  taxRateVerdict,
  type Composition,
  type Row,
} from "../../scripts/audit-gross-sales-composition"

const TAX_RATE = 0.095

/** A composition with everything out, to build from. */
const NONE: Composition = {
  discounts: false,
  tax: false,
  serviceCharges: false,
  fees: false,
  refunds: false,
}

const withTerms = (...on: Array<keyof Composition>): Composition => {
  const c = { ...NONE }
  for (const t of on) c[t] = true
  return c
}

/**
 * One slice of trading under a stated truth about what `gross` contains.
 *
 * `subtotal` is the list price of what was sold. The deduction columns are
 * passed signed negative, as Otter sends them, rather than being negated on
 * use.
 */
function slice(opts: {
  subtotal: number
  discount?: number
  serviceCharges?: number
  fees?: number
  refunds?: number
  taxRate?: number
  /** Which components gross carries. Net never carries any of them. */
  grossCarries: Array<keyof Composition>
  platform?: string
}): Row {
  const discount = opts.discount ?? 0
  const serviceCharges = opts.serviceCharges ?? 0
  const fees = opts.fees ?? 0
  const refunds = opts.refunds ?? 0
  const rate = opts.taxRate ?? TAX_RATE

  // Tax is charged on what was actually sold: the subtotal after discounts.
  const taxable = opts.subtotal + discount
  const tax = taxable * rate

  const carries = new Set(opts.grossCarries)

  // Net is the takings after every deduction, and never carries tax.
  const net = taxable + fees + refunds

  // Gross starts from net and adds back whatever it is said to carry.
  let gross = net
  if (carries.has("discounts")) gross -= discount
  if (carries.has("tax")) gross += tax
  if (carries.has("serviceCharges")) gross += serviceCharges
  if (carries.has("fees")) gross -= fees
  if (carries.has("refunds")) gross -= refunds

  return {
    platform: opts.platform ?? "css-pos",
    gross,
    net,
    discounts: discount,
    tax,
    serviceCharges,
    fees,
    refunds,
  }
}

/**
 * Twenty slices of genuinely varied trading.
 *
 * Not twenty scaled copies: the tax rate moves, some days are discounted and
 * some are not, and the caller's own variation rides on top. Every identity
 * under test is linear and scale-free, so scaling alone adds no power.
 */
function month(make: (i: number) => Row): Row[] {
  return Array.from({ length: 20 }, (_, i) => make(i))
}

const varied = (grossCarries: Array<keyof Composition>, extra: (i: number) => Partial<Parameters<typeof slice>[0]> = () => ({})) =>
  month((i) =>
    slice({
      subtotal: 400 + i * 91,
      // Half the days carry a discount, and the size moves independently.
      discount: i % 2 === 0 ? -(i * 7 + 3) : 0,
      // The rate moves so a fixture cannot pass by matching one constant.
      taxRate: TAX_RATE + (i % 4) * 0.005,
      grossCarries,
      ...extra(i),
    }),
  )

/* ── The space of readings ────────────────────────────────────────────── */

describe("gross-sales composition — the space of readings", () => {
  it("enumerates every independent combination exactly once", () => {
    const all = allCompositions()
    expect(all.length).toBe(2 ** TERMS.length)
    const keys = new Set(all.map((c) => TERMS.map((t) => (c[t] ? "1" : "0")).join("")))
    expect(keys.size).toBe(all.length)
  })
})

/* ── The method discriminates ─────────────────────────────────────────── */

describe("gross-sales composition — the method discriminates", () => {
  it("finds a gross that carries the discount and the tax", () => {
    const rows = varied(["discounts", "tax"])
    const { composition, score } = bestComposition(rows)

    expect(score.hitRate).toBe(1)
    expect(composition.tax).toBe(true)
    expect(composition.discounts).toBe(true)
    expect(composition.serviceCharges).toBe(false)
  })

  it("finds a gross that carries the discount but NOT the tax", () => {
    // The same test in the other direction. Without it, a scorer that simply
    // preferred more terms would pass the one above.
    const rows = varied(["discounts"])
    const { composition, score } = bestComposition(rows)

    expect(score.hitRate).toBe(1)
    expect(composition.tax).toBe(false)
    expect(composition.discounts).toBe(true)
  })

  it("finds a gross that is already net of the discount", () => {
    // The reading an earlier version could not express at all: every
    // hypothesis it had added the discount back, so a post-discount gross
    // reconciled with nothing and the report said so about the wrong thing.
    const rows = varied(["tax"])
    const { composition, score } = bestComposition(rows)

    expect(score.hitRate).toBe(1)
    expect(composition.discounts).toBe(false)
    expect(composition.tax).toBe(true)
  })

  it("constrains the FEES term, whose sign rests on a convention", () => {
    // This test exists because a review mutated the fees formula from `-fees`
    // to `+fees` and the whole suite stayed green: no fixture ever set a fee.
    const rows = varied(["discounts", "tax", "fees"], () => ({ fees: -120 }))
    const { composition, score } = bestComposition(rows)

    expect(score.hitRate).toBe(1)
    expect(composition.fees).toBe(true)

    // And the opposite reading must actually lose on those same rows.
    const flipped = { ...composition, fees: false }
    expect(scoreComposition(rows, flipped).hitRate).toBe(0)
  })

  it("constrains the REFUNDS term the same way", () => {
    const rows = varied(["discounts", "tax", "refunds"], () => ({ refunds: -75 }))
    const { composition } = bestComposition(rows)
    expect(composition.refunds).toBe(true)
    expect(scoreComposition(rows, { ...composition, refunds: false }).hitRate).toBe(0)
  })

  it("separates service charges inside gross from service charges beside it", () => {
    // The 4040 line in `salesRowValues` ADDS service charges on top of gross.
    // If they were already inside it, Total Sales double-counts them.
    const inside = varied(["discounts", "tax", "serviceCharges"], () => ({ serviceCharges: 45 }))
    const beside = varied(["discounts", "tax"], () => ({ serviceCharges: 45 }))

    expect(bestComposition(inside).composition.serviceCharges).toBe(true)
    expect(bestComposition(beside).composition.serviceCharges).toBe(false)
  })

  it("reports no hits at all when nothing describes the data", () => {
    // The outcome the method must be able to reach, or its verdict means
    // nothing. Net here is unrelated to gross by any of the 32 readings.
    const rows = month((i) => ({
      platform: "css-pos",
      gross: 1000 + i * 37,
      net: 400 + i,
      discounts: 0,
      tax: 90,
      serviceCharges: 20,
      fees: -50,
      refunds: 0,
    }))

    const { score } = bestComposition(rows)
    expect(score.hitRate).toBeLessThan(0.2)
  })
})

/* ── Deciding a term only where it can be decided ─────────────────────── */

describe("gross-sales composition — a term is decided where it is material", () => {
  it("answers the tax question even when service charges are almost never taken", () => {
    // The bug this replaced, and the one most likely to bite on real data. A
    // first-party counter sale carries no marketplace fee and usually no
    // service charge, so readings that differ only in those terms predict
    // identically on almost every row. Scoring the flip over ALL rows made
    // the runner-up look just as good and the report said "inconclusive"
    // about a tax question answered cleanly on every single row.
    const rows = [
      ...varied(["discounts", "tax"], () => ({ serviceCharges: 0 })),
      ...varied(["discounts", "tax"], () => ({ serviceCharges: 40 })).slice(0, 2),
    ]

    const { composition } = bestComposition(rows)
    const tax = decideTerm(rows, composition, "tax")

    expect(tax.carried).toBe(true)
    expect(tax.decidingRows).toBe(rows.length)
  })

  it("says it cannot tell about a term no slice ever carries", () => {
    // Withholding is the honest answer, and it must be distinguishable from
    // a confident "no".
    const rows = varied(["discounts", "tax"], () => ({ serviceCharges: 0 }))
    const { composition } = bestComposition(rows)

    const svc = decideTerm(rows, composition, "serviceCharges")
    expect(svc.decidingRows).toBe(0)
    expect(svc.carried).toBeNull()
  })

  it("does not let a term vote on a slice where it rounds to nothing", () => {
    const tiny = slice({ subtotal: 1000, serviceCharges: 0.01, grossCarries: ["discounts", "tax"] })
    const real = slice({ subtotal: 1000, serviceCharges: 60, grossCarries: ["discounts", "tax"] })

    expect(isMaterial(tiny, "serviceCharges")).toBe(false)
    expect(isMaterial(real, "serviceCharges")).toBe(true)
  })
})

/* ── Nulls are not zeroes ─────────────────────────────────────────────── */

describe("gross-sales composition — a null is not a zero", () => {
  it("keeps a slice with no tax reading out of the tax question", () => {
    // Counting a null tax as $0 of tax on a real base is what let the rate
    // method answer confidently and wrongly.
    const rows = varied(["discounts", "tax"]).map((r, i) =>
      i < 5 ? { ...r, tax: null } : r,
    )
    const { composition } = bestComposition(rows)
    const tax = decideTerm(rows, composition, "tax")

    expect(tax.decidingRows).toBe(15)
    expect(tax.carried).toBe(true)
  })

  it("leaves a null out of the implied rate entirely, numerator and base", () => {
    // Every slice is taxed at the same rate, so the pooled rate must come
    // back as exactly that rate however many readings are missing. Zeroing a
    // null instead would drag it down by the share that are — which is the
    // mechanism of the confidently wrong verdict.
    const full = month((i) =>
      slice({ subtotal: 1000 + i * 13, discount: -(i * 2), grossCarries: ["discounts", "tax"] }),
    )
    const holed = full.map((r, i) => (i < 5 ? { ...r, tax: null } : r))

    expect(impliedTaxRates(full, true).inclusive).toBeCloseTo(TAX_RATE, 6)
    expect(impliedTaxRates(holed, true).inclusive).toBeCloseTo(TAX_RATE, 6)

    // And the zeroing it replaced really would have moved it: a quarter of
    // the readings missing pulls the rate down by about a quarter.
    const zeroed = full.map((r, i) => (i < 5 ? { ...r, tax: 0 } : r))
    expect(impliedTaxRates(zeroed, true).inclusive as number).toBeLessThan(TAX_RATE * 0.85)
  })

  it("scores a composition only over the slices that can supply its terms", () => {
    const rows = varied(["discounts", "tax", "fees"], () => ({ fees: -100 })).map((r, i) =>
      i < 4 ? { ...r, fees: null } : r,
    )
    const withFees = scoreComposition(rows, withTerms("discounts", "tax", "fees"))
    expect(withFees.rows).toBe(16)
    expect(withFees.hitRate).toBe(1)
  })
})

/* ── Slices that cannot speak ─────────────────────────────────────────── */

describe("gross-sales composition — slices that cannot speak", () => {
  it("skips a slice with no takings rather than dividing by it", () => {
    const rows: Row[] = [
      { platform: "css-pos", gross: 0, net: 0, discounts: 0, tax: 0, serviceCharges: 0, fees: 0, refunds: 0 },
      slice({ subtotal: 1000, grossCarries: ["discounts", "tax"] }),
    ]
    const s = scoreComposition(rows, withTerms("discounts", "tax"))
    expect(s.rows).toBe(1)
    expect(Number.isFinite(s.meanAbsResidualPct as number)).toBe(true)
  })

  it("skips a fully refunded slice, whose negative gross would invert the residual", () => {
    // The guard is `<= 0` rather than `=== 0` for the reason `pctOfSales`
    // carries the same one: a negative denominator does not throw, it flips
    // the sign of the residual, and a wrong reading would then look right.
    const rows: Row[] = [
      { platform: "css-pos", gross: -500, net: -500, discounts: 0, tax: 0, serviceCharges: 0, fees: 0, refunds: 0 },
      slice({ subtotal: 1000, grossCarries: ["discounts", "tax"] }),
    ]
    expect(scoreComposition(rows, withTerms("discounts", "tax")).rows).toBe(1)
  })

  it("reports no reading rather than a perfect one when nothing could be scored", () => {
    // Zero would read as a flawless fit for an empty set, which is the most
    // misleading default available to a diagnostic.
    const s = scoreComposition([], NONE)
    expect(s.rows).toBe(0)
    expect(s.hitRate).toBeNull()
    expect(s.meanAbsResidualPct).toBeNull()
  })

  it("gives a small slice a cents budget rather than a hairline one", () => {
    // A $20 cash slice gets a 2-cent budget under a purely relative
    // tolerance, while several independently cent-rounded columns drift
    // further than that between them.
    const base = slice({ subtotal: 20, grossCarries: ["discounts", "tax"] })
    const rounded = { ...base, net: base.net + 0.03 }

    expect(scoreComposition([rounded], withTerms("discounts", "tax")).hitRate).toBe(1)
  })
})

/* ── The sign profile ─────────────────────────────────────────────────── */

describe("gross-sales composition — signs are measured, not asserted", () => {
  it("counts how each column actually arrived", () => {
    const rows = [
      slice({ subtotal: 1000, discount: -50, fees: -20, grossCarries: ["discounts"] }),
      slice({ subtotal: 1000, discount: -50, fees: -20, grossCarries: ["discounts"] }),
      slice({ subtotal: 1000, discount: 0, fees: 0, grossCarries: ["discounts"] }),
    ]
    const p = signProfile(rows, "discounts")
    expect(p.negative).toBe(2)
    expect(p.zero).toBe(1)
    expect(p.absent).toBe(0)
  })

  it("reports a column that arrived with the wrong sign, rather than hiding it", () => {
    // `computeDeposit` carries a `signDrift` guard because this can happen.
    // If it ever does, the hit rate drops with no explanation unless the
    // report says which column moved.
    const rows = [{ ...slice({ subtotal: 1000, discount: -50, grossCarries: ["discounts"] }), discounts: 50 }]
    expect(signProfile(rows, "discounts").positive).toBe(1)
  })

  it("counts an absent column as absent, not as zero", () => {
    const rows = [{ ...slice({ subtotal: 1000, grossCarries: ["discounts"] }), refunds: null }]
    const p = signProfile(rows, "refunds")
    expect(p.absent).toBe(1)
    expect(p.zero).toBe(0)
  })
})

/* ── The implied tax rate, which corroborates and does not decide ─────── */

describe("gross-sales composition — the implied tax rate", () => {
  it("recovers the statutory rate from the true reading, under discounts", () => {
    // It only works if discounts come out of the base: tax is charged on what
    // was sold, not on what was listed.
    const rows = month((i) =>
      slice({ subtotal: 1000 + i * 13, discount: -(i * 2), grossCarries: ["discounts", "tax"] }),
    )
    const rates = impliedTaxRates(rows, true)

    expect(rates.inclusive).toBeCloseTo(TAX_RATE, 6)
    expect(taxRateVerdict(rates, TAX_RATE)).toBe("inclusive")
  })

  it("recovers it from the other reading too", () => {
    const rows = month((i) =>
      slice({ subtotal: 800 + i * 11, discount: -(i * 3), grossCarries: ["discounts"] }),
    )
    const rates = impliedTaxRates(rows, true)

    expect(rates.exclusive).toBeCloseTo(TAX_RATE, 6)
    expect(taxRateVerdict(rates, TAX_RATE)).toBe("exclusive")
  })

  it("does not call a tie when both readings sit inside a fixed window", () => {
    // The bug this replaced. On this fixture the two implied rates land about
    // a point apart, straddling statutory; a "within one point" test called
    // it neither, while the right answer sat exactly on the number.
    const rows = month((i) =>
      slice({ subtotal: 800 + i * 11, discount: -(i * 3), grossCarries: ["discounts"] }),
    )
    const rates = impliedTaxRates(rows, true)

    expect(Math.abs((rates.inclusive as number) - TAX_RATE)).toBeLessThan(0.01)
    expect(Math.abs((rates.exclusive as number) - TAX_RATE)).toBeLessThan(0.01)
    expect(taxRateVerdict(rates, TAX_RATE)).toBe("exclusive")
  })

  it("still answers in a low-rate jurisdiction, where the readings sit closer", () => {
    // At 5% the two readings are 0.24 points apart rather than 0.82, so a
    // fixed half-point margin refused to answer at all on exact data. The
    // thresholds are relative to the rate for this reason.
    const low = 0.05
    const rows = month((i) =>
      slice({ subtotal: 900 + i * 17, discount: -(i * 4), taxRate: low, grossCarries: ["discounts", "tax"] }),
    )
    const rates = impliedTaxRates(rows, true)

    expect(rates.inclusive).toBeCloseTo(low, 6)
    expect(taxRateVerdict(rates, low)).toBe("inclusive")
  })

  it("withholds a verdict when neither reading is near the rate", () => {
    const rows = month(() => ({
      platform: "css-pos",
      gross: 1000,
      net: 1000,
      discounts: 0,
      tax: 10, // 1%, nothing like a sales tax
      serviceCharges: 0,
      fees: 0,
      refunds: 0,
    }))
    expect(taxRateVerdict(impliedTaxRates(rows, false), TAX_RATE)).toBeNull()
  })

  it("returns null rather than a rate taken over a negative base", () => {
    const rows: Row[] = [
      { platform: "css-pos", gross: 100, net: 0, discounts: -300, tax: 20, serviceCharges: 0, fees: 0, refunds: 0 },
    ]
    const rates = impliedTaxRates(rows, true)
    expect(rates.inclusive).toBeNull()
    expect(rates.exclusive).toBeNull()
    expect(taxRateVerdict(rates, TAX_RATE)).toBeNull()
  })

  it("refuses a nonsensical statutory rate instead of comparing against NaN", () => {
    const rates = { inclusive: 0.095, exclusive: 0.0868 }
    expect(taxRateVerdict(rates, Number.NaN)).toBeNull()
    expect(taxRateVerdict(rates, 0)).toBeNull()
  })

  it("is the method that can be fooled, which is why it does not decide", () => {
    // The finding that demoted this from verdict to corroboration. Gross here
    // genuinely EXCLUDES tax, but a tenth of the sales were exempt — cold
    // food to go, which California does not tax. The rate method then points
    // at "inclusive", confidently and wrongly, and "inclusive" is exactly
    // what the P&L already assumes.
    const rows = month((i) =>
      slice({
        subtotal: 1000,
        // Every tenth slice sold something untaxed.
        taxRate: i % 10 === 0 ? 0 : TAX_RATE,
        grossCarries: ["discounts"],
      }),
    )

    const fooled = taxRateVerdict(impliedTaxRates(rows, true), TAX_RATE)
    expect(fooled).not.toBe("exclusive")

    // The reconciliation is not fooled, because it reads `net`, which the
    // rate method never touches. That is the whole reason it is the verdict.
    expect(bestComposition(rows).composition.tax).toBe(false)
  })
})

/* ── Leftover ─────────────────────────────────────────────────────────── */

describe("gross-sales composition — the leftover", () => {
  it("is the part of gross that net does not account for", () => {
    const r = slice({ subtotal: 1000, discount: -100, grossCarries: ["discounts", "tax"] })
    // Gross carries the discount back and the tax; net carries neither.
    expect(leftover(r)).toBeCloseTo(100 + (r.tax as number), 6)
  })
})
