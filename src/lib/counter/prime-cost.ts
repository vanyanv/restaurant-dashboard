/**
 * Prime cost, once.
 *
 * Note 60: Overview read 56.2% and the P&L read 57.9% for the same range,
 * because one counted hourly wages and the other counted hourly plus the
 * salaried line. Both cells were labelled "Labor" and both figures were
 * called "Prime cost". It is the one number in the product with a published
 * ceiling behind it, so it cannot be two numbers. This module is the reason
 * it cannot happen again — every page that prints prime cost calls this
 * function, and there is no second implementation to drift from.
 *
 * WHICH LABOUR (ruling R2, Plan 8). Prime cost is the WHOLE wage bill.
 * `getAllStoresPnL` returns exactly one labour figure per store —
 * `computeStorePnL` blends Harri clock-in actuals for the days Harri covers
 * with `Store.fixedMonthlyLabor` prorated across the days it does not. That
 * field is labelled "Labor · monthly" in the store dossier, with a
 * placeholder of 29600: it is a whole monthly payroll, not a salaried
 * top-up. So the blend is a substitution, and the sum below is already the
 * whole wage bill. Do NOT add `fixedMonthlyLabor` on top of it — that
 * double-counts labour on every day Harri covered.
 *
 * The Labor page's own figure is a DIFFERENT question (the schedule's hourly
 * share) and keeps a different name — "Hourly labor" — which is the other
 * half of note 60's resolution.
 */

/**
 * The trade's published benchmark: food plus labour under 60% of sales.
 *
 * A constant, not a store field (ruling R3, Plan 8). `Store` carries
 * `targetCogsPct` and no prime-cost target; the prototype takes this from a
 * store file the real schema does not have. Adding the column is a migration,
 * and a migration is not what this plan is for.
 */
export const PRIME_CEILING_PCT = 60

export interface PrimeCostInput {
  /** The denominator. Gross sales, matching what the cascade starts from. */
  grossSales: number
  cogsValue: number
  /** The whole blended wage bill — see the module note. */
  laborValue: number
}

export interface PrimeCost {
  cogsValue: number
  laborValue: number
  primeValue: number
  /** null when there is no denominator to divide by. Never 0 — see below. */
  cogsPct: number | null
  laborPct: number | null
  primePct: number | null
  ceilingPct: number
  /** Percentage points of room under the ceiling. Negative means over it. */
  roomPp: number | null
  overCeiling: boolean
}

/** One decimal, because one decimal is what every page prints. */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function primeCost(input: PrimeCostInput): PrimeCost {
  const { grossSales, cogsValue, laborValue } = input
  const primeValue = cogsValue + laborValue

  /*
   * A zero or negative denominator has no answer, and the honest way to say
   * so is null — which `format.ts` already prints as an em-dash.
   *
   * Returning 0 instead would be actively misleading twice over: a pre-open
   * store with fit-out costs and no revenue would read "0.0% prime cost",
   * which is a perfect score rather than an absent one; and a range of pure
   * refunds (negative gross) would divide by a negative and print prime cost
   * as a large negative percentage, which reads as a triumph. `overCeiling`
   * is false in both cases because an unknown figure has not breached
   * anything.
   */
  if (grossSales <= 0) {
    return {
      cogsValue,
      laborValue,
      primeValue,
      cogsPct: null,
      laborPct: null,
      primePct: null,
      ceilingPct: PRIME_CEILING_PCT,
      roomPp: null,
      overCeiling: false,
    }
  }

  const primePct = round1((primeValue / grossSales) * 100)

  return {
    cogsValue,
    laborValue,
    primeValue,
    cogsPct: round1((cogsValue / grossSales) * 100),
    laborPct: round1((laborValue / grossSales) * 100),
    primePct,
    ceilingPct: PRIME_CEILING_PCT,
    // Rounded from the already-rounded percentage, so the room an owner
    // reads is always exactly the ceiling minus the number printed beside
    // it. Deriving it from the unrounded value instead produces "56.2%,
    // 3.9 points under 60%", which is arithmetic the reader can see is wrong.
    roomPp: round1(PRIME_CEILING_PCT - primePct),
    overCeiling: primePct > PRIME_CEILING_PCT,
  }
}
