import { z } from "zod"
import { dateRangeSchema, parseDateRange, resolveStoreIds, ymd } from "./_shared"
import type { ChatTool } from "./types"

/**
 * The crew and the published schedule: who works at each store, and who is on
 * which shift on which day. Before this the chat could say how many hours were
 * worked (`getLaborActuals`) but not by whom, nor who is on tomorrow.
 *
 * Names are the only personal field returned: first name and last initial.
 * Emails, phone numbers, Harri ids and check-in PINs never leave this file.
 *
 * Scheduled hours leave out `isVirtual` shifts (an unfilled slot the manager
 * left on the grid), the same rule `labor-week.ts` uses for the Labor page's
 * "scheduled hours", so the two never disagree. Open slots are still listed,
 * because "is anyone covering Saturday close?" is exactly about them.
 *
 * The schedule only reaches the database when Harri's schedule sync runs, so
 * each store says the last day it has shifts for. A day after that is "not
 * synced yet", never "nobody is working".
 */

const params = z
  .object({
    storeIds: z
      .array(z.string().min(1))
      .optional()
      .describe("Restrict to these store ids from listStores. Omit for every store."),
    dateRange: dateRangeSchema
      .optional()
      .describe(
        "Inclusive YYYY-MM-DD days of schedule to return, up to 14; may be in the future. Omit for the crew list only.",
      ),
  })
  .strict()

const LA = "America/Los_Angeles"
const round1 = (n: number) => Math.round(n * 10) / 10

function shortName(first: string | null | undefined, last: string | null | undefined): string {
  const f = (first ?? "").trim()
  const l = (last ?? "").trim()
  if (!f && !l) return "Unknown"
  return l ? `${f} ${l[0].toUpperCase()}.`.trim() : f
}

function clock(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: LA })
}

export type CrewScheduleResult = {
  from: string | null
  to: string | null
  stores: Array<{
    storeId: string
    storeName: string
    crew: Array<{ name: string; active: boolean; source: string }>
    /** Last day this store has any published shift for, or null if Harri never sent one. */
    scheduleSyncedThrough: string | null
    days: Array<{
      date: string
      /** Hours on filled shifts only. Null when no schedule is synced for the day. */
      scheduledHours: number | null
      shifts: Array<{ name: string; position: string; start: string; end: string; hours: number }>
      /** Unfilled slots left on the schedule. */
      openSlots: Array<{ position: string; start: string; end: string; hours: number }>
    }>
  }>
  note: string
}

export const getCrewAndSchedule: ChatTool<typeof params, CrewScheduleResult> = {
  name: "getCrewAndSchedule",
  description:
    "The crew list for each store (names, active or not) and the published Harri schedule: who works which shift, position, start and end time, scheduled hours per day, and unfilled open slots. Works for future days. Use for 'who is working tomorrow', 'who closes Saturday', 'who works at Glendale', 'how many people are on the schedule'. For hours actually worked or labour cost use getLaborActuals.",
  parameters: params,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    let from: Date | null = null
    let to: Date | null = null
    if (args.dateRange) {
      ;({ from, to } = parseDateRange(args.dateRange))
      if ((to.getTime() - from.getTime()) / 86_400_000 > 13) {
        throw new Error("dateRange is limited to 14 days for the schedule")
      }
    }
    const scope = { storeId: { in: storeIds }, store: { accountId: ctx.accountId } }

    const [stores, crew, employees, shifts, lastShift] = await Promise.all([
      ctx.prisma.store.findMany({
        where: { id: { in: storeIds }, accountId: ctx.accountId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      ctx.prisma.crewMember.findMany({
        where: scope,
        select: { storeId: true, firstName: true, lastName: true, active: true, source: true },
        orderBy: [{ active: "desc" }, { firstName: "asc" }],
      }),
      from
        ? ctx.prisma.harriEmployee.findMany({
            where: scope,
            select: { storeId: true, userId: true, firstName: true, lastName: true },
          })
        : Promise.resolve([]),
      from && to
        ? ctx.prisma.harriShift.findMany({
            where: { ...scope, date: { gte: from, lte: to } },
            select: {
              storeId: true, date: true, startTime: true, endTime: true, minutes: true,
              userId: true, isVirtual: true, positionName: true, positionCode: true,
            },
            orderBy: [{ date: "asc" }, { startTime: "asc" }],
          })
        : Promise.resolve([]),
      ctx.prisma.harriShift.groupBy({ by: ["storeId"], where: scope, _max: { date: true } }),
    ])

    const nameOf = new Map(employees.map((e) => [`${e.storeId}:${e.userId}`, shortName(e.firstName, e.lastName)]))
    const syncedThrough = new Map(lastShift.map((r) => [r.storeId, r._max.date ? ymd(r._max.date) : null]))

    const dayKeys: string[] = []
    if (from && to) {
      for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) dayKeys.push(ymd(new Date(t)))
    }

    return {
      from: from ? ymd(from) : null,
      to: to ? ymd(to) : null,
      stores: stores.map((s) => {
        const mine = shifts.filter((sh) => sh.storeId === s.id)
        return {
          storeId: s.id,
          storeName: s.name,
          crew: crew
            .filter((c) => c.storeId === s.id)
            .map((c) => ({ name: shortName(c.firstName, c.lastName), active: c.active, source: String(c.source) })),
          scheduleSyncedThrough: syncedThrough.get(s.id) ?? null,
          days: dayKeys.map((day) => {
            const rows = mine.filter((sh) => ymd(sh.date) === day)
            const filled = rows.filter((sh) => !sh.isVirtual && sh.userId != null)
            const open = rows.filter((sh) => sh.isVirtual || sh.userId == null)
            return {
              date: day,
              scheduledHours: rows.length === 0 ? null : round1(filled.reduce((t, sh) => t + sh.minutes, 0) / 60),
              shifts: filled.map((sh) => ({
                name: nameOf.get(`${s.id}:${sh.userId}`) ?? "Unknown",
                position: sh.positionName ?? sh.positionCode,
                start: clock(sh.startTime),
                end: clock(sh.endTime),
                hours: round1(sh.minutes / 60),
              })),
              openSlots: open.map((sh) => ({
                position: sh.positionName ?? sh.positionCode,
                start: clock(sh.startTime),
                end: clock(sh.endTime),
                hours: round1(sh.minutes / 60),
              })),
            }
          }),
        }
      }),
      note:
        "A day with scheduledHours null and no shifts has no schedule synced from Harri yet; it does not mean nobody works. " +
        "Compare the date with scheduleSyncedThrough before saying a day is empty. Times are Los Angeles time.",
    }
  },
}
