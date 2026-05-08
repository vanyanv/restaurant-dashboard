const MS_PER_DAY = 24 * 60 * 60 * 1000

export type ReorderStatus = "ok" | "reorder_soon" | "reorder_now" | "urgent" | "no_signal"

export interface ReorderRecommendation {
  status: ReorderStatus
  /** onHand / ratePerDay; null when ratePerDay is 0 or onHand is negative. */
  daysOfCover: number | null
  /** max(1, 0.5 × leadDays). */
  safetyDays: number
  /** daysOfCover − leadDays − safetyDays. Negative = behind; positive = slack. */
  slackDays: number
  /** asOf + max(0, slackDays). Null on no_signal. Never returns a past date. */
  reorderBy: Date | null
}

/**
 * Pure function. Decides the reorder status from on-hand quantity, daily
 * depletion rate, and vendor lead time. The data layer feeds it numbers; the
 * dashboard reads the status.
 */
export function computeReorderRecommendation(input: {
  onHand: number
  ratePerDay: number
  leadDays: number
  asOf: Date
}): ReorderRecommendation {
  const { onHand, ratePerDay, leadDays, asOf } = input

  const safetyDays = Math.max(1, 0.5 * leadDays)

  if (ratePerDay <= 0 || onHand < 0) {
    return {
      status: "no_signal",
      daysOfCover: null,
      safetyDays,
      slackDays: 0,
      reorderBy: null,
    }
  }

  const daysOfCover = onHand / ratePerDay
  const slackDays = daysOfCover - leadDays - safetyDays

  let status: ReorderStatus
  if (slackDays >= 3) status = "ok"
  else if (slackDays >= 0) status = "reorder_soon"
  else if (slackDays >= -leadDays) status = "reorder_now"
  else status = "urgent"

  const slackForDate = Math.max(0, slackDays)
  const reorderBy = new Date(asOf.getTime() + slackForDate * MS_PER_DAY)

  return { status, daysOfCover, safetyDays, slackDays, reorderBy }
}
