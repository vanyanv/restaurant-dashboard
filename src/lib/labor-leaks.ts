/**
 * Ranks a week's labor problems by dollars so the labor page can lead with a
 * decision instead of a wall of metrics.
 *
 * Three lenses, deliberately kept separate:
 *   drift — paid minutes beyond the published schedule (timekeeping alerts)
 *   hours — clock hours staffed while earning far below the day's own rate
 *   day   — a day that bought more hours than its sales justified
 *
 * They overlap and MUST NOT be summed into a headline total: an early clock-in
 * at 9am is also part of the 9am block. Each leak states its own basis so a
 * reader can see what kind of number it is.
 */

/** Alert codes that ADD paid minutes beyond the schedule. */
export const DRIFT_ADDING_CODES = ["EARLY_CLOCK_IN", "LATE_CLOCK_OUT"] as const
/** Alert codes that REMOVE paid minutes (cheaper, but a service risk). */
export const DRIFT_SAVING_CODES = ["LATE_CLOCK_IN", "EARLY_CLOCK_OUT"] as const

export interface AlertInput {
  alertCode: string
  timeDiffSec: number | null
  userId: number
  employeeName?: string | null
}

export interface ClockDrift {
  addedHours: number
  savedHours: number
  netHours: number
  addedCost: number
  netCost: number
  addedCount: number
  /** Whoever contributed the most added hours, for a name to talk to. */
  topContributor: { name: string; hours: number; count: number } | null
}

export function computeClockDrift(
  alerts: AlertInput[],
  blendedRate: number | null
): ClockDrift {
  let addedHours = 0
  let savedHours = 0
  let addedCount = 0
  const byUser = new Map<number, { name: string; hours: number; count: number }>()

  for (const a of alerts) {
    const hours = Math.abs(a.timeDiffSec ?? 0) / 3600
    if (hours === 0) continue

    if ((DRIFT_ADDING_CODES as readonly string[]).includes(a.alertCode)) {
      addedHours += hours
      addedCount += 1
      const prev = byUser.get(a.userId)
      const name = a.employeeName?.trim() || `User ${a.userId}`
      byUser.set(a.userId, {
        name,
        hours: (prev?.hours ?? 0) + hours,
        count: (prev?.count ?? 0) + 1,
      })
    } else if ((DRIFT_SAVING_CODES as readonly string[]).includes(a.alertCode)) {
      savedHours += hours
    }
  }

  const netHours = addedHours - savedHours
  const top = [...byUser.values()].sort((a, b) => b.hours - a.hours)[0] ?? null

  return {
    addedHours,
    savedHours,
    netHours,
    addedCost: blendedRate != null ? addedHours * blendedRate : 0,
    netCost: blendedRate != null ? netHours * blendedRate : 0,
    addedCount,
    topContributor: top,
  }
}

export interface HourBlockInput {
  hour: number
  staffedHours: number
  netSales: number
  splh: number | null
}

export interface HourBlock {
  hours: number[]
  staffedHours: number
  cost: number
  splh: number
  dayRate: number
}

/**
 * Contiguous run of staffed hours earning below `share` of the week's own
 * sales-per-staffed-hour. Relative on purpose: an absolute dollar floor would
 * condemn every hour at a slow store and flag none at a busy one.
 */
export function worstHourBlock(
  hours: HourBlockInput[],
  blendedRate: number | null,
  share = 0.5
): HourBlock | null {
  const totalSales = hours.reduce((a, h) => a + h.netSales, 0)
  const totalStaffed = hours.reduce((a, h) => a + h.staffedHours, 0)
  if (totalStaffed <= 0) return null

  const dayRate = totalSales / totalStaffed
  const floor = dayRate * share

  const flagged = hours.filter((h) => h.staffedHours > 0.01 && (h.splh ?? 0) < floor)
  if (flagged.length === 0) return null

  const staffedHours = flagged.reduce((a, h) => a + h.staffedHours, 0)
  const blockSales = flagged.reduce((a, h) => a + h.netSales, 0)

  return {
    hours: flagged.map((h) => h.hour).sort((a, b) => a - b),
    staffedHours,
    cost: blendedRate != null ? staffedHours * blendedRate : 0,
    splh: staffedHours > 0 ? blockSales / staffedHours : 0,
    dayRate,
  }
}

export interface DayLeakInput {
  date: string
  weekday: string
  varianceHours: number | null
  varianceDollars: number | null
  splh: number | null
  status: string
}

/** The single day that most exceeded the hours its sales earned. */
export function worstDay(rows: DayLeakInput[]): DayLeakInput | null {
  const over = rows.filter((r) => (r.varianceDollars ?? 0) > 0)
  if (over.length === 0) return null
  return over.reduce((worst, r) =>
    (r.varianceDollars ?? 0) > (worst.varianceDollars ?? 0) ? r : worst
  )
}

export interface Leak {
  id: "drift" | "hours" | "day"
  title: string
  amount: number
  /** What kind of number `amount` is. Prevents reading three lenses as a sum. */
  basis: string
  evidence: string
  action: string
}

const usd = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`
const hourLabel = (h: number) => (h === 0 ? "12am" : h === 12 ? "12pm" : h < 12 ? `${h}am` : `${h - 12}pm`)

/** Build the ranked leak ledger. Empty when the week has nothing to answer for. */
export function rankLeaks(input: {
  drift: ClockDrift
  block: HourBlock | null
  day: DayLeakInput | null
}): Leak[] {
  const leaks: Leak[] = []

  if (input.drift.addedHours > 0.5) {
    const top = input.drift.topContributor
    leaks.push({
      id: "drift",
      title: "Clock drift",
      amount: input.drift.addedCost,
      basis: "paid beyond schedule",
      evidence: `${input.drift.addedCount} punches added ${input.drift.addedHours.toFixed(1)} hours${
        top ? `, ${top.hours.toFixed(1)} of them from ${top.name}` : ""
      }.`,
      action: "Tighten clock-in grace in Harri, or move the shift start to match when people actually arrive.",
    })
  }

  if (input.block) {
    const list = input.block.hours.map(hourLabel)
    const span =
      list.length === 1 ? list[0] : `${list[0]}–${hourLabel(input.block.hours[input.block.hours.length - 1] + 1)}`
    leaks.push({
      id: "hours",
      title: `Opening hours · ${span}`,
      amount: input.block.cost,
      basis: "wages in the weakest hours",
      evidence: `${input.block.staffedHours.toFixed(1)} staffed hours earned ${usd(
        input.block.splh
      )}/hr against a week average of ${usd(input.block.dayRate)}/hr.`,
      action: "Cut one opener or push the first shift later, then watch the 10am ticket times.",
    })
  }

  if (input.day && input.day.varianceDollars != null) {
    leaks.push({
      id: "day",
      title: input.day.weekday === "" ? "Worst day" : `${input.day.weekday} overstaffed`,
      amount: input.day.varianceDollars,
      basis: "hours above earned",
      evidence: `${input.day.varianceHours?.toFixed(1)} hours more than the sales justified${
        input.day.splh != null ? `, at ${usd(input.day.splh)} per labor hour` : ""
      }.`,
      action: "Drop the shift that overlaps the slowest block on that weekday.",
    })
  }

  return leaks.sort((a, b) => b.amount - a.amount)
}
