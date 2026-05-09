// Phase 1 — Coverage gap: raw vendor lead-time cache.
//
// `getVendorReliability` (in forecasts.ts) already exposes the composite
// 0-100 score with its three sub-metrics. This tool surfaces the simpler
// median-lead-days cache so the chat can answer "how long does Sysco take
// to deliver?" without invoking the full reliability bundle.

import { z } from "zod"
import type { ChatTool } from "./types"

const leadTimesParams = z
  .object({
    minSampleSize: z
      .number()
      .int()
      .min(1)
      .optional()
      .default(3)
      .describe(
        "Skip vendors with fewer than N invoice gaps used in the median. Below 3 the lead-time falls back to the per-account default and isn't meaningful.",
      ),
    limit: z.number().int().min(1).max(100).optional().default(40),
    sortBy: z
      .enum(["leadDaysDesc", "leadDaysAsc", "sampleDesc"])
      .optional()
      .default("leadDaysDesc"),
  })
  .strict()

export type VendorLeadTimeChatRow = {
  vendorName: string
  medianLeadDays: number
  sampleSize: number
  lastComputedAt: string
}

export const listVendorLeadTimes: ChatTool<
  typeof leadTimesParams,
  VendorLeadTimeChatRow[]
> = {
  name: "listVendorLeadTimes",
  description:
    "Returns the cached per-vendor median lead time in days, recomputed nightly from the gap between consecutive Invoice rows for each vendor. Use for 'which vendor is slowest?', 'how long does delivery take from X?', 'lead time for the cheese vendor'. For deeper signal (price volatility, monthly-total CV, composite reliability score) call getVendorReliability instead.",
  parameters: leadTimesParams,
  async execute(args, ctx) {
    const rows = await ctx.prisma.vendorLeadTime.findMany({
      where: {
        accountId: ctx.accountId,
        sampleSize: { gte: args.minSampleSize ?? 3 },
      },
      select: {
        vendorNameNormalized: true,
        medianLeadDays: true,
        sampleSize: true,
        lastComputedAt: true,
      },
    })

    const sorted = [...rows].sort((a, b) => {
      switch (args.sortBy ?? "leadDaysDesc") {
        case "leadDaysAsc":
          return a.medianLeadDays - b.medianLeadDays
        case "sampleDesc":
          return b.sampleSize - a.sampleSize
        case "leadDaysDesc":
        default:
          return b.medianLeadDays - a.medianLeadDays
      }
    })

    return sorted.slice(0, args.limit ?? 40).map((r) => ({
      vendorName: r.vendorNameNormalized,
      medianLeadDays: r.medianLeadDays,
      sampleSize: r.sampleSize,
      lastComputedAt: r.lastComputedAt.toISOString(),
    }))
  },
}
