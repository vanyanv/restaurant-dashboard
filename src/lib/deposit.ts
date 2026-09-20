/**
 * What should land in the bank for a day's trading — computed once.
 *
 * Two independently written copies of this formula existed, and they agreed
 * only by coincidence. `otter-analytics-aggregation.ts` subtracted
 * `Math.abs(taxRemitted)`, `Math.abs(fees)` and `Math.abs(paidOut)`;
 * `dashboard-analytics-actions.ts` ADDED the same three columns unmodified,
 * behind a runtime warning that fires if any of them arrives positive.
 *
 * Both are right while Otter's sign convention holds — those three columns are
 * signed deductions, so adding a negative and subtracting its magnitude are
 * the same arithmetic. The day Otter flips one, they diverge: the addition
 * version reports a wrong deposit loudly, and the `Math.abs` version keeps
 * subtracting from a genuinely positive figure in silence, which is the worse
 * of the two failures. So there is one function, it does the addition, and it
 * carries the guard.
 *
 * Pure — no Prisma, no session — so both callers can share it.
 */

export type DepositInputs = {
  netSales: number
  taxCollected: number
  /** Signed deduction: tax handed to the authority. Expected <= 0. */
  taxRemitted: number
  tips: number
  serviceCharges: number
  /** Signed deduction: the marketplace's cut. Expected <= 0. */
  fees: number
  /** Cash added to the till. */
  paidIn: number
  /** Signed deduction: cash taken out of the till. Expected <= 0. */
  paidOut: number
}

export type Deposit = {
  /** Before the till movements. */
  theoreticalDeposit: number
  /** After them — what the bank should actually see. */
  expectedDeposit: number
  /**
   * The columns that arrived with the wrong sign, if any. Non-empty means the
   * two figures above are not trustworthy: a positive deduction is added
   * rather than subtracted and inflates the deposit.
   */
  signDrift: string[]
}

export function computeDeposit(input: DepositInputs): Deposit {
  const signDrift: string[] = []
  if (input.taxRemitted > 0) signDrift.push("taxRemitted")
  if (input.fees > 0) signDrift.push("fees")
  if (input.paidOut > 0) signDrift.push("paidOut")

  const theoreticalDeposit =
    input.netSales +
    input.taxCollected +
    input.taxRemitted +
    input.tips +
    input.serviceCharges +
    input.fees

  return {
    theoreticalDeposit,
    expectedDeposit: theoreticalDeposit + input.paidIn + input.paidOut,
    signDrift,
  }
}
