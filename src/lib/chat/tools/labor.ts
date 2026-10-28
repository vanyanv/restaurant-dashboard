import { z } from "zod"
import { dateRangeSchema, parseDateRange, resolveStoreIds } from "./_shared"
import type { ChatTool } from "./types"
import { loadLaborFigures } from "@/lib/counter/labor-figures"
import type { DateRange } from "@/lib/counter/date-range"

/**
 * Labour as it was worked, from Harri: hours, cost, labour % of Total Sales,
 * sales per labour hour, the role split, overtime, and the timekeeping leaks
 * (clocking in early, out late). Before this the chat reached labour only as
 * one dollar line inside `getPnlSummary` and as a forward-looking staffing
 * forecast, so "how many hours did Van Nuys work last week" had no answer.
 *
 * Every figure comes from `loadLaborFigures`, the chain the Labor page runs,
 * so the chat and the page cannot print two labour percentages for one week.
 */

const params = z
  .object({
    storeId: z
      .string()
      .min(1)
      .optional()
      .describe("One store id from listStores. Omit for every store combined."),
    dateRange: dateRangeSchema.describe(
      "Inclusive YYYY-MM-DD range. Up to about 92 days; for a single week pass Monday to Sunday.",
    ),
  })
  .strict()

const round2 = (n: number) => Math.round(n * 100) / 100
const round1 = (n: number) => Math.round(n * 10) / 10
const orNull = (n: number | null, f: (n: number) => number) => (n === null ? null : f(n))

export type LaborActualsResult = {
  storeId: string | null
  from: string
  to: string
  /** False when Harri has no labour rows for the range — a store not linked, not synced yet, or no longer active. */
  hasLabor: boolean
  totals: {
    actualHours: number
    scheduledHours: number | null
    laborCost: number
    /** Labour over Total Sales, 0..100 — the P&L's own labour line. */
    laborPct: number | null
    /** Total Sales (the P&L's Net Sales) per hour worked. */
    salesPerLaborHour: number | null
    /** Store-days that sold but have no labour reading in Harri; laborCost is short by them. */
    missingLaborStoreDays: number
    overtimeCost: number
    avgHourlyRate: number | null
  }
  days: Array<{
    date: string
    actualHours: number
    scheduledHours: number | null
    /** Null when Harri has no labour reading for the day (see `laborMissing`). */
    laborCost: number | null
    /** True when a store that sold that day has no labour reading. */
    laborMissing: boolean
    laborPct: number | null
    salesPerLaborHour: number | null
  }>
  /** How to read `roles` against `totals.laborCost`. */
  note: string
  roles: Array<{ position: string; payType: string; hours: number; cost: number; sharePct: number }>
  /** Clock-in/out drift, costed at the range's average hourly rate. Null with no hours worked. */
  timekeeping: {
    extraHours: number
    extraCost: number
    alertsNotCostable: number
    byKind: Array<{ label: string; kind: string; alerts: number; people: number; hours: number | null; cost: number | null }>
  } | null
}

function localRange(from: Date, to: Date): DateRange {
  // `parseDateRange` returns UTC midnights; the Counter loaders read calendar
  // days off LOCAL getters (see `toQueryBounds`), so rebuild the same days.
  return {
    start: new Date(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
    end: new Date(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()),
  }
}

export const getLaborActuals: ChatTool<typeof params, LaborActualsResult> = {
  name: "getLaborActuals",
  description:
    "Labour actually worked, from Harri: hours worked vs scheduled, labour cost, labour % of Total Sales (same figure as the P&L), sales per labour hour, overtime cost, cost and hours by position (cook, cashier, manager), per-day rows, and timekeeping drift (early clock-ins, late clock-outs) costed in dollars. Use for any question about past or current labour hours, labour %, overtime, who/which role costs most, or clock-in problems. For FUTURE staffing use getLaborStaffingForecast.",
  parameters: params,
  async execute(args, ctx) {
    const [storeId] = args.storeId ? await resolveStoreIds(ctx, [args.storeId]) : [null]
    const { from, to } = parseDateRange(args.dateRange)
    const span = (to.getTime() - from.getTime()) / 86_400_000
    if (span > 91) throw new Error("dateRange is limited to 92 days for labour")

    const f = await loadLaborFigures({
      range: localRange(from, to),
      storeId,
      accountId: ctx.accountId,
    })
    const { week } = f

    return {
      storeId,
      from: args.dateRange.from,
      to: args.dateRange.to,
      hasLabor: f.days.some((d) => d.actualHours > 0 || d.cost > 0),
      totals: {
        actualHours: round1(week.actualHours),
        scheduledHours: orNull(week.scheduledHours, round1),
        laborCost: round2(week.cost),
        laborPct: orNull(week.laborPct, round1),
        salesPerLaborHour: orNull(week.splh, round2),
        missingLaborStoreDays: week.missingStoreDays,
        overtimeCost: round2(week.overtimeCost),
        avgHourlyRate: orNull(week.blendedRate, round2),
      },
      days: f.days.map((d) => ({
        date: d.key,
        actualHours: round1(d.actualHours),
        scheduledHours: orNull(d.scheduledHours, round1),
        // A day with nothing read is missing, not $0. When only some stores
        // are missing the others' dollars stay and `laborMissing` says it.
        laborCost: d.costMissing && d.cost === 0 ? null : round2(d.cost),
        laborMissing: d.costMissing,
        laborPct: orNull(d.laborPct, round1),
        salesPerLaborHour: orNull(d.splh, round2),
      })),
      note:
        "laborCost uses Harri's daily total where it has one and the sum of position rows otherwise; " +
        "roles[].cost always comes from position rows, so roles may not sum to laborCost on days the " +
        "daily total was used. Days with laborMissing true have no labour reading and are left out of " +
        "laborPct and salesPerLaborHour.",
      roles: f.roles.map((r) => ({
        position: r.position,
        payType: r.payType,
        hours: round1(r.hours),
        cost: round2(r.cost),
        sharePct: round1(r.share),
      })),
      timekeeping: f.leaks
        ? {
            extraHours: round1(f.leaks.leakedHours),
            extraCost: round2(f.leaks.leakedCost),
            alertsNotCostable: f.leaks.uncostableAlerts,
            byKind: f.leaks.rows.map((r) => ({
              label: r.label,
              kind: r.kind,
              alerts: r.alerts,
              people: r.people,
              hours: orNull(r.hours, round1),
              cost: orNull(r.cost, round2),
            })),
          }
        : null,
    }
  },
}
