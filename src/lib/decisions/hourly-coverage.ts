/**
 * Forecast demand per hour against the shifts actually posted for it.
 *
 * The daily lane can say Thursday is 8.2 hours short. It can't say *when*, and
 * a manager posts shifts, not day-totals. `ForecastHourlyOrders` carries the
 * demand curve and `HarriShift` the coverage, so crossing them names the
 * stretch to staff.
 *
 * "Needed" follows the daily lane's logic one grain down: the store's own
 * throughput in orders per labor hour, not a target nobody configured.
 */

/**
 * The trading day, in order.
 *
 * Predicted orders peak at hour 23 (40.7) and are still 36.4 at hour 0 and 14.5
 * at hour 1 — this store trades past midnight. A 00:00-23:00 axis would split
 * the evening across both ends of the chart, so the window wraps and hours 0
 * and 1 belong to the trading day that started the previous morning.
 */
export const OPERATING_HOURS = [
  10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1,
] as const

export interface HourInput {
  hour: number
  predictedOrders: number
  /** Labor hours posted for this clock hour, from bucketShiftHours. */
  staffedHours: number
}

export interface HourCoverage extends HourInput {
  /** Labor hours this hour's demand takes at typical throughput. */
  neededHours: number | null
  /** staffed − needed. Negative means short. */
  gapHours: number | null
  isShort: boolean
}

export interface HourlyCoverage {
  hours: HourCoverage[]
  /** Busiest hour's order count — the chart scales to this. */
  peakOrders: number
  /**
   * The longest run of short hours. `endHour` is exclusive, so 18→21 reads as
   * "6pm to 9pm" — the shape of a shift rather than a list of hours.
   */
  worstStretch: { startHour: number; endHour: number; shortHours: number } | null
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Hours below this gap are rounding, not understaffing. */
const SHORT_THRESHOLD_HOURS = 0.25

export function buildHourlyCoverage(
  rows: HourInput[],
  ordersPerLaborHour: number | null,
): HourlyCoverage {
  const usable = ordersPerLaborHour != null && ordersPerLaborHour > 0

  const hours: HourCoverage[] = rows.map((r) => {
    if (!usable) {
      return { ...r, neededHours: null, gapHours: null, isShort: false }
    }
    const neededHours = round1(r.predictedOrders / ordersPerLaborHour!)
    const gapHours = round1(r.staffedHours - neededHours)
    return { ...r, neededHours, gapHours, isShort: gapHours < -SHORT_THRESHOLD_HOURS }
  })

  return {
    hours,
    peakOrders: hours.reduce((m, h) => Math.max(m, h.predictedOrders), 0),
    worstStretch: longestShortRun(hours),
  }
}

/**
 * The longest contiguous run of short hours, and the labor hours it is missing.
 * Longest rather than deepest: a manager fixes a three-hour hole by posting one
 * shift, and a single very short hour usually isn't worth a call.
 */
function longestShortRun(hours: HourCoverage[]): HourlyCoverage["worstStretch"] {
  let best: HourlyCoverage["worstStretch"] = null
  let runStart = -1
  let runShort = 0

  const close = (endIndex: number) => {
    if (runStart < 0) return
    const length = endIndex - runStart
    const bestLength =
      best == null ? 0 : hoursBetween(best.startHour, best.endHour)
    if (length > bestLength) {
      best = {
        startHour: hours[runStart].hour,
        endHour: hours[endIndex - 1].hour + 1 === 24 ? 0 : hours[endIndex - 1].hour + 1,
        shortHours: round1(runShort),
      }
    }
    runStart = -1
    runShort = 0
  }

  hours.forEach((h, i) => {
    if (h.isShort) {
      if (runStart < 0) runStart = i
      runShort += Math.abs(h.gapHours ?? 0)
    } else {
      close(i)
    }
  })
  close(hours.length)

  return best
}

/** Length of an hour range that may wrap past midnight. */
function hoursBetween(startHour: number, endHour: number): number {
  return endHour > startHour ? endHour - startHour : endHour + 24 - startHour
}
