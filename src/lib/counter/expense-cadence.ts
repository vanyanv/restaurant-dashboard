/**
 * A fixed expense as entered (weekly, monthly or yearly) turned into its
 * monthly equivalent. One table, shared by the store settings page and the
 * chat's `getStoreSettings`, so the two never print different monthly costs
 * for one line. See the note above its old home in `adapters/stores.ts`: a
 * yearly line divided wrongly here is a live money bug.
 */
export type ExpenseCadence = "WEEKLY" | "MONTHLY" | "YEARLY"

export const MONTHLY_FROM: Record<ExpenseCadence, number> = {
  WEEKLY: 52 / 12,
  MONTHLY: 1,
  YEARLY: 1 / 12,
}
