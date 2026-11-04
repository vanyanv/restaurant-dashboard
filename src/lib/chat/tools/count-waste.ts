import { z } from "zod"
import { resolveStoreIds } from "./_shared"
import type { ChatTool } from "./types"
import {
  getCountReportSectionPromises,
  getCountWasteSectionPromises,
  type GapRow,
} from "@/lib/counter/adapters/count"

/**
 * Count & waste: the weekly report (what each item should have been against
 * what was counted, in dollars) and the last seven days of the waste log.
 *
 * Read through the Count & waste page's own adapter, so the "missing $" the
 * chat quotes is the number on the report screen — it is
 * `runningOnHandFromContext`, the same "should have" the on-hand model uses.
 * The report needs two completed counts; until a store has them the tool says
 * so rather than inventing a gap.
 */

const params = z
  .object({
    storeIds: z
      .array(z.string().min(1))
      .optional()
      .describe("Restrict to these store ids from listStores. Omit for every store."),
  })
  .strict()

const round2 = (n: number) => Math.round(n * 100) / 100
const round1 = (n: number) => Math.round(n * 10) / 10

export type CountWasteResult = {
  stores: Array<{
    storeId: string
    storeName: string
    /** Sections that could not be read for this store; the other stores still answer. */
    errors: string[]
    /** Null when the store has fewer than two completed counts: there is no report yet. */
    report: {
      count: string
      comparedWith: string
      /** Shortages only, in dollars: should have − counted, summed over items that came up short. */
      missingDollars: number
      /** Overages, as a positive figure. Never netted against the shortages. */
      extraDollars: number
      wasteDollars: number
      theftDollars: number
      returnDollars: number
      otherDollars: number
      /** Logged entries on items not counted both times; not on any row. */
      offReportEntries: number
      offReportDollars: number
      /** Worst gaps first, at most 15. */
      items: Array<{
        name: string
        unit: string
        lastCount: number
        delivered: number
        used: number
        wasted: number
        shouldHave: number
        counted: number
        missing: number
        missingDollars: number | null
        /** Some deliveries could not be converted (no case size yet), so shouldHave may be low. */
        partial: boolean
      }>
    } | null
    /** Completed counts on file, up to the 12 the report looks back over. */
    completedCounts: number
    /** The waste log, last 7 days, newest first. */
    wasteLastWeek: {
      /** Priced entries only; see unpricedEntries. */
      dollars: number
      /** Entries whose ingredient has no cost yet: counted in entries, not in dollars. */
      unpricedEntries: number
      entries: Array<{ item: string; amount: string; reason: string; when: string; dollars: number | null; note: string | null }>
    } | null
    /** How often each item has been ordered over 8 weeks, top 10 by spend. */
    orderFrequency: Array<{ item: string; vendor: string; orders: number; usually: string; amount: string; every: string }>
  }>
}

function item(r: GapRow) {
  return {
    name: r.name,
    unit: r.unit,
    lastCount: round1(r.last),
    delivered: round1(r.delivered),
    used: round1(r.used),
    wasted: round1(r.waste),
    shouldHave: round1(r.should),
    counted: round1(r.counted),
    missing: round1(r.missing),
    missingDollars: r.missingDollars === null ? null : round2(r.missingDollars),
    partial: r.partial,
  }
}

export const getCountAndWaste: ChatTool<typeof params, CountWasteResult> = {
  name: "getCountAndWaste",
  description:
    "The Count & waste report per store: the latest weekly count against the one before — what each item should have been vs what was counted, missing dollars (shortages), extra dollars (overages), waste / theft / returns in dollars, worst items first — plus the last 7 days of the waste log with reasons and how often each item is ordered. Use for 'how much went missing', 'what did we throw out this week', 'how much waste', 'what's short on the count'. Needs two completed counts before a report exists.",
  parameters: params,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const stores = await ctx.prisma.store.findMany({
      where: { id: { in: storeIds }, accountId: ctx.accountId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })

    const out = await Promise.all(
      stores.map(async (s) => {
        const [report, waste] = await Promise.all([
          getCountReportSectionPromises({ accountId: ctx.accountId, storeId: s.id }).report,
          getCountWasteSectionPromises({ accountId: ctx.accountId, storeId: s.id }).waste,
        ])
        const errors: string[] = []
        if (report.status === "failed") errors.push(`count report could not be read: ${report.error}`)
        if (waste.status === "failed") errors.push(`waste log could not be read: ${waste.error}`)
        const r = report.status === "ready" || report.status === "stale" ? report.data : null
        const w = waste.status === "ready" || waste.status === "stale" ? waste.data : null
        return {
          storeId: s.id,
          storeName: s.name,
          errors,
          report:
            r && r.current && r.previous
              ? {
                  count: r.current.label,
                  comparedWith: r.previous.label,
                  missingDollars: round2(r.missingDollars),
                  extraDollars: round2(r.extraDollars),
                  wasteDollars: round2(r.wasteDollars),
                  theftDollars: round2(r.theftDollars),
                  returnDollars: round2(r.returnDollars),
                  otherDollars: round2(r.otherDollars),
                  offReportEntries: r.offReportEntries,
                  offReportDollars: round2(r.offReportDollars),
                  items: r.rows.slice(0, 15).map(item),
                }
              : null,
          completedCounts: r?.counts.length ?? 0,
          wasteLastWeek: w
            ? {
                dollars: round2(w.weekDollars),
                unpricedEntries: w.recent.filter((e) => e.dollars === null).length,
                entries: w.recent.map((e) => ({
                  item: e.name,
                  amount: e.amount,
                  reason: e.reason,
                  when: e.when,
                  dollars: e.dollars === null ? null : round2(e.dollars),
                  note: e.note,
                })),
              }
            : null,
          orderFrequency: (r?.orders ?? []).slice(0, 10).map((o) => ({
            item: o.name,
            vendor: o.vendor,
            orders: o.orders,
            usually: o.usually,
            amount: o.amount,
            every: o.every,
          })),
        }
      }),
    )
    return { stores: out }
  },
}
