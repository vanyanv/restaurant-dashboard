// Phase 1 — Coverage gap: expose the inventory surface to the chat.
//
// All four tools are read-only and owner-scoped. The dashboard / coverage
// wrappers reuse server actions that do their own session lookup; the
// stock-count and adjustment tools query Prisma directly through the
// owner-scoped store list.

import { z } from "zod"
import { resolveStoreIds, storeIdsSchema, ymd } from "./_shared"
import type { ChatTool } from "./types"
import { getInventoryDashboardData } from "@/app/actions/inventory/dashboard-actions"
import { getInventoryCoverageHealth } from "@/app/actions/inventory/coverage-health-actions"

// ---------------------------------------------------------------------------
// getInventoryStatus
// ---------------------------------------------------------------------------

const inventoryStatusParams = z
  .object({
    storeId: z
      .string()
      .min(1)
      .describe(
        "Store id. Resolve from listStores first; this tool is per-store, not multi-store.",
      ),
    statusFilter: z
      .enum(["all", "ok", "reorder_soon", "reorder_now", "urgent", "no_signal"])
      .optional()
      .default("all")
      .describe(
        "Restrict to a single reorder bucket. 'all' returns every ingredient. 'urgent' = already past the safe reorder window; 'reorder_now' = inside the lead-time window; 'reorder_soon' = approaching it; 'ok' = comfortable cover; 'no_signal' = no usage data to model from.",
      ),
    limit: z.number().int().min(1).max(200).optional().default(40),
  })
  .strict()

export type InventoryStatusChatRow = {
  ingredientName: string
  category: string
  recipeUnit: string
  onHand: number
  ratePerDay: number
  daysOfCover: number | null
  status: string
  slackDays: number
  reorderBy: string | null
  recentVendor: string | null
  leadDays: number
  confidenceLevel: string
  isGraduated: boolean
}

export type InventoryStatusChatResult = {
  storeId: string
  storeName: string
  asOf: string
  totalIngredients: number
  reorderNow: number
  reorderSoon: number
  rows: InventoryStatusChatRow[]
}

export const getInventoryStatus: ChatTool<
  typeof inventoryStatusParams,
  InventoryStatusChatResult | { ok: false; error: string }
> = {
  name: "getInventoryStatus",
  description:
    "Current per-ingredient inventory status for ONE store: on-hand qty, daily depletion rate, days of cover, reorder-by date, and recent vendor. status is one of REORDER_NOW (out-of-cover-window already), REORDER_SOON (within lead time), or OK. Use for 'what do I need to reorder?', 'how much X do we have left?', 'when does ingredient Y run out?'. confidenceLevel reflects how well-calibrated the on-hand estimate is per (store, ingredient). Default returns the full ingredient list capped at limit, sorted by urgency.",
  parameters: inventoryStatusParams,
  async execute(args, ctx) {
    const result = await getInventoryDashboardData({ storeId: args.storeId })
    if (!result) return { ok: false, error: "no_session" }
    if (!result.ok) return { ok: false, error: result.error }
    void ctx

    const d = result.data
    let rows = d.rows
    if (args.statusFilter && args.statusFilter !== "all") {
      rows = rows.filter((r) => r.status === args.statusFilter)
    }

    // Sort by urgency — already-blown windows first, then approaching ones.
    const urgencyRank: Record<string, number> = {
      urgent: 0,
      reorder_now: 1,
      reorder_soon: 2,
      ok: 3,
      no_signal: 4,
    }
    rows = [...rows].sort((a, b) => {
      const ra = urgencyRank[a.status] ?? 5
      const rb = urgencyRank[b.status] ?? 5
      if (ra !== rb) return ra - rb
      const ca = a.daysOfCover ?? Number.POSITIVE_INFINITY
      const cb = b.daysOfCover ?? Number.POSITIVE_INFINITY
      return ca - cb
    })

    const reorderNow = d.rows.filter(
      (r) => r.status === "reorder_now" || r.status === "urgent",
    ).length
    const reorderSoon = d.rows.filter((r) => r.status === "reorder_soon").length

    return {
      storeId: d.storeId,
      storeName: d.storeName,
      asOf: d.asOf.toISOString(),
      totalIngredients: d.rows.length,
      reorderNow,
      reorderSoon,
      rows: rows.slice(0, args.limit ?? 40).map((r) => ({
        ingredientName: r.ingredientName,
        category: r.category,
        recipeUnit: r.recipeUnit,
        onHand: r.onHand,
        ratePerDay: r.ratePerDay,
        daysOfCover: r.daysOfCover,
        status: r.status,
        slackDays: r.slackDays,
        reorderBy: r.reorderBy ? ymd(r.reorderBy) : null,
        recentVendor: r.recentVendorRaw,
        leadDays: r.leadDays,
        confidenceLevel: r.confidenceLevel,
        isGraduated: r.isGraduated,
      })),
    }
  },
}

// ---------------------------------------------------------------------------
// getInventoryCoverage
// ---------------------------------------------------------------------------

const coverageParams = z
  .object({
    storeId: z.string().min(1),
  })
  .strict()

export type InventoryCoverageChatResult = {
  storeId: string
  storeName: string
  windowStart: string
  windowEnd: string
  totalSalesRevenue: number
  mappedRevenue: number
  unmappedRevenue: number
  coveragePct: number | null
  conversionGapCount: number
}

export const getInventoryCoverage: ChatTool<
  typeof coverageParams,
  InventoryCoverageChatResult | { ok: false; error: string }
> = {
  name: "getInventoryCoverage",
  description:
    "Diagnostic: what fraction of the last 7 days of sales revenue is mapped to a costed recipe (and therefore visible to inventory depletion). coveragePct < 0.85 means food cost / depletion numbers are missing significant volume — surface this caveat when answering ANY food-cost or inventory question. conversionGapCount counts SKU matches with cross-unit conversions still on default factor 1 (likely-bogus passthroughs).",
  parameters: coverageParams,
  async execute(args, ctx) {
    const result = await getInventoryCoverageHealth({ storeId: args.storeId })
    if (!result) return { ok: false, error: "no_session" }
    if (!result.ok) return { ok: false, error: result.error }
    void ctx
    const d = result.data
    return {
      storeId: d.storeId,
      storeName: d.storeName,
      windowStart: ymd(d.windowStart),
      windowEnd: ymd(d.windowEnd),
      totalSalesRevenue: d.totalSalesRevenue,
      mappedRevenue: d.mappedRevenue,
      unmappedRevenue: d.unmappedRevenue,
      coveragePct: d.coveragePct,
      conversionGapCount: d.conversionGapCount,
    }
  },
}

// ---------------------------------------------------------------------------
// listStockCounts
// ---------------------------------------------------------------------------

const listCountsParams = z
  .object({
    storeIds: storeIdsSchema,
    limit: z.number().int().min(1).max(50).optional().default(15),
    statusFilter: z
      .enum(["IN_PROGRESS", "COMPLETED", "ABANDONED"])
      .optional()
      .describe("Restrict to one count status. Omit for all."),
  })
  .strict()

export type StockCountChatRow = {
  id: string
  storeId: string
  status: string
  countedAt: string
  completedAt: string | null
  note: string | null
  lineCount: number
}

export const listStockCountsTool: ChatTool<
  typeof listCountsParams,
  StockCountChatRow[]
> = {
  name: "listStockCounts",
  description:
    "Lists recent physical inventory counts. status: IN_PROGRESS (operator started, not yet completed), COMPLETED (delta + calibration jobs ran), ABANDONED. Use to answer 'when did we last count?', 'how often are we counting?', 'is there an open count?'. Sorted by countedAt desc.",
  parameters: listCountsParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const limit = args.limit ?? 15
    const rows = await ctx.prisma.stockCount.findMany({
      where: {
        storeId: { in: storeIds },
        ...(args.statusFilter ? { status: args.statusFilter } : {}),
      },
      orderBy: { countedAt: "desc" },
      take: limit,
      select: {
        id: true,
        storeId: true,
        status: true,
        countedAt: true,
        completedAt: true,
        note: true,
        _count: { select: { lines: true } },
      },
    })
    return rows.map((r) => ({
      id: r.id,
      storeId: r.storeId,
      status: r.status,
      countedAt: r.countedAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      note: r.note,
      lineCount: r._count.lines,
    }))
  },
}

// ---------------------------------------------------------------------------
// getRecentInventoryAdjustments
// ---------------------------------------------------------------------------

const adjustmentsParams = z
  .object({
    storeIds: storeIdsSchema,
    sinceDays: z.number().int().min(1).max(180).optional().default(30),
    reasonFilter: z
      .enum(["THEFT", "EXPIRY", "SUPPLIER_RETURN", "DAMAGE", "OTHER"])
      .optional(),
    limit: z.number().int().min(1).max(100).optional().default(25),
  })
  .strict()

export type InventoryAdjustmentChatRow = {
  storeId: string
  ingredientName: string
  recipeUnit: string
  occurredAt: string
  qty: number
  reason: string
  note: string | null
  loggedBy: string | null
}

export const getRecentInventoryAdjustments: ChatTool<
  typeof adjustmentsParams,
  InventoryAdjustmentChatRow[]
> = {
  name: "getRecentInventoryAdjustments",
  description:
    "Returns logged manual adjustments to running on-hand (theft, expiry, supplier returns, damage, other). qty is always positive — the value subtracted from stock. Use to answer 'what's been thrown out?', 'any theft logged this month?', 'who logged the latest adjustment?'. Sorted by occurredAt desc. NEVER call out an individual user as a thief — surface the user as the LOGGER of the entry, not the implicated party.",
  parameters: adjustmentsParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const since = new Date()
    since.setDate(since.getDate() - (args.sinceDays ?? 30))
    const rows = await ctx.prisma.inventoryAdjustment.findMany({
      where: {
        storeId: { in: storeIds },
        occurredAt: { gte: since },
        ...(args.reasonFilter ? { reason: args.reasonFilter } : {}),
      },
      orderBy: { occurredAt: "desc" },
      take: args.limit ?? 25,
      select: {
        storeId: true,
        occurredAt: true,
        qty: true,
        reason: true,
        note: true,
        canonicalIngredient: { select: { name: true, recipeUnit: true } },
        createdByUser: { select: { name: true, email: true } },
      },
    })
    return rows.map((r) => ({
      storeId: r.storeId,
      ingredientName: r.canonicalIngredient.name,
      recipeUnit: r.canonicalIngredient.recipeUnit ?? "",
      occurredAt: r.occurredAt.toISOString(),
      qty: r.qty,
      reason: r.reason,
      note: r.note,
      loggedBy: r.createdByUser.name ?? r.createdByUser.email ?? null,
    }))
  },
}
