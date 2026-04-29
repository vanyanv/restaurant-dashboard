import { z } from "zod"
import { embed, toVectorLiteral } from "@/lib/chat/embeddings"
import {
  dateRangeSchema,
  parseDateRange,
  resolveStoreIds,
  storeIdsSchema,
  ymd,
} from "./_shared"
import type { ChatTool } from "./types"

const searchParams = z
  .object({
    query: z
      .string()
      .min(1)
      .describe("Natural-language description of what was bought (e.g. 'chicken thighs', 'olive oil', 'frozen french fries')."),
    storeIds: storeIdsSchema,
    dateRange: dateRangeSchema.optional().describe("Optional invoice-date filter."),
    limit: z.number().int().min(1).max(50).optional().default(10),
  })
  .strict()

export type InvoiceSearchRow = {
  invoiceId: string
  lineId: string
  vendor: string
  item: string
  unit: string | null
  amount: number
  /** Invoice date in `YYYY-MM-DD`. Null if the invoice has no parsed date. */
  date: string | null
  storeId: string | null
  /** Cosine similarity 0..1 — higher is more relevant. */
  score: number
}

export const searchInvoices: ChatTool<typeof searchParams, InvoiceSearchRow[]> = {
  name: "searchInvoices",
  description:
    "Vector search over the owner's invoice line items. Use this when the user asks about a vendor purchase or ingredient by description (e.g. 'what did we spend on chicken thighs in March?'). Returns the top-k matches; pair with sumInvoiceLines to total them.",
  parameters: searchParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const vec = await embed(args.query)
    const lit = toVectorLiteral(vec)
    const limit = args.limit ?? 10

    const range = args.dateRange ? parseDateRange(args.dateRange) : null

    const rows = await ctx.prisma.$queryRawUnsafe<
      Array<{
        invoiceId: string
        invoiceLineId: string | null
        vendorName: string
        productName: string
        unit: string | null
        extendedPrice: number
        invoiceDate: Date | null
        storeId: string | null
        score: number
      }>
    >(
      `SELECT e."invoiceId",
              e."invoiceLineId",
              i."vendorName",
              l."productName",
              l."unit",
              l."extendedPrice"::float8 AS "extendedPrice",
              i."invoiceDate",
              i."storeId",
              (1 - (e.embedding <=> $1::vector))::float8 AS score
         FROM "InvoiceLineEmbedding" e
         JOIN "InvoiceLineItem" l ON l.id = e."invoiceLineId"
         JOIN "Invoice"         i ON i.id = e."invoiceId"
        WHERE e."ownerId" = $2
          AND (i."storeId" IS NULL OR i."storeId" = ANY($3::text[]))
          AND ($4::date IS NULL OR i."invoiceDate" >= $4::date)
          AND ($5::date IS NULL OR i."invoiceDate" <= $5::date)
        ORDER BY e.embedding <=> $1::vector
        LIMIT $6`,
      lit,
      ctx.ownerId,
      storeIds,
      range ? range.from.toISOString().slice(0, 10) : null,
      range ? range.to.toISOString().slice(0, 10) : null,
      limit,
    )

    return rows.map((r) => ({
      invoiceId: r.invoiceId,
      lineId: r.invoiceLineId ?? "",
      vendor: r.vendorName,
      item: r.productName,
      unit: r.unit,
      amount: Number(r.extendedPrice),
      date: r.invoiceDate ? ymd(r.invoiceDate) : null,
      storeId: r.storeId,
      score: Number(r.score),
    }))
  },
}

const topInvoicesParams = z
  .object({
    storeIds: storeIdsSchema,
    dateRange: dateRangeSchema,
    topN: z.number().int().min(1).max(50).optional().default(10),
  })
  .strict()

export type TopInvoiceRow = {
  invoiceId: string
  vendor: string
  totalAmount: number
  date: string | null
  storeId: string | null
  lineCount: number
}

export const getTopInvoices: ChatTool<typeof topInvoicesParams, TopInvoiceRow[]> = {
  name: "getTopInvoices",
  description:
    "Returns the largest invoices for an owner-scoped slice of stores in a date range, ordered by totalAmount desc. Use this for 'biggest expense', 'top vendors by spend', 'largest invoices' style questions. This is the structured tool — do NOT use searchInvoices for amount-ranked questions; vector search ranks by text similarity, not money.",
  parameters: topInvoicesParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const { from, to } = parseDateRange(args.dateRange)

    const rows = await ctx.prisma.invoice.findMany({
      where: {
        ownerId: ctx.ownerId,
        OR: [
          { storeId: null },
          { storeId: { in: storeIds } },
        ],
        invoiceDate: { gte: from, lte: to },
      },
      select: {
        id: true,
        vendorName: true,
        totalAmount: true,
        invoiceDate: true,
        storeId: true,
        _count: { select: { lineItems: true } },
      },
      orderBy: { totalAmount: "desc" },
      take: args.topN ?? 10,
    })

    return rows.map((r) => ({
      invoiceId: r.id,
      vendor: r.vendorName,
      totalAmount: r.totalAmount,
      date: r.invoiceDate ? ymd(r.invoiceDate) : null,
      storeId: r.storeId,
      lineCount: r._count.lineItems,
    }))
  },
}

const spendParams = z
  .object({
    storeIds: storeIdsSchema,
    dateRange: dateRangeSchema,
  })
  .strict()

export type InvoiceSpendResult = {
  totalAmount: number
  invoiceCount: number
  averageInvoice: number | null
  byVendor: Array<{ vendor: string; amount: number; invoiceCount: number; share: number }>
  byMonth: Array<{ month: string; amount: number; invoiceCount: number }>
}

export const getInvoiceSpend: ChatTool<typeof spendParams, InvoiceSpendResult> = {
  name: "getInvoiceSpend",
  description:
    "Total invoice spend for the owner across a date range, plus breakdowns by vendor (top vendors share of spend) and by month. Use this for 'how much did we spend on supplies last month?', 'who's our biggest vendor?', 'how does spend trend month-over-month?'. Includes every invoice in range; does not require a search query.",
  parameters: spendParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const { from, to } = parseDateRange(args.dateRange)

    const rows = await ctx.prisma.invoice.findMany({
      where: {
        ownerId: ctx.ownerId,
        OR: [
          { storeId: null },
          { storeId: { in: storeIds } },
        ],
        invoiceDate: { gte: from, lte: to },
      },
      select: {
        totalAmount: true,
        invoiceDate: true,
        vendorName: true,
      },
    })

    let total = 0
    const vendorMap = new Map<string, { amount: number; invoiceCount: number }>()
    const monthMap = new Map<string, { amount: number; invoiceCount: number }>()
    for (const r of rows) {
      total += r.totalAmount
      const v = vendorMap.get(r.vendorName) ?? { amount: 0, invoiceCount: 0 }
      v.amount += r.totalAmount
      v.invoiceCount += 1
      vendorMap.set(r.vendorName, v)
      const month = r.invoiceDate
        ? r.invoiceDate.toISOString().slice(0, 7)
        : "unknown"
      const m = monthMap.get(month) ?? { amount: 0, invoiceCount: 0 }
      m.amount += r.totalAmount
      m.invoiceCount += 1
      monthMap.set(month, m)
    }

    return {
      totalAmount: total,
      invoiceCount: rows.length,
      averageInvoice: rows.length > 0 ? total / rows.length : null,
      byVendor: Array.from(vendorMap.entries())
        .map(([vendor, v]) => ({
          vendor,
          amount: v.amount,
          invoiceCount: v.invoiceCount,
          share: total > 0 ? v.amount / total : 0,
        }))
        .sort((a, b) => b.amount - a.amount),
      byMonth: Array.from(monthMap.entries())
        .map(([month, v]) => ({ month, ...v }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    }
  },
}

const invoiceByIdParams = z
  .object({
    id: z.string().min(1).describe("The Invoice id (cuid) to fetch."),
  })
  .strict()

export type InvoiceByIdLine = {
  lineId: string
  lineNumber: number
  productName: string
  description: string | null
  category: string | null
  unit: string | null
  quantity: number
  unitPrice: number
  extendedPrice: number
  canonicalIngredient: string | null
}

export type InvoiceByIdResult = {
  invoiceId: string
  vendor: string
  invoiceNumber: string
  date: string | null
  storeId: string | null
  storeName: string | null
  status: string
  subtotal: number | null
  taxAmount: number | null
  totalAmount: number
  lineCount: number
  lines: InvoiceByIdLine[]
}

export const getInvoiceById: ChatTool<typeof invoiceByIdParams, InvoiceByIdResult | null> = {
  name: "getInvoiceById",
  description:
    "Fetches one invoice header plus all line items for the owner. Use this when the user asks to see / open / look at a specific invoice (typically after searchInvoices or getTopInvoices returned an id). Returns null when the invoice doesn't exist or isn't owned by the caller.",
  parameters: invoiceByIdParams,
  async execute(args, ctx) {
    const inv = await ctx.prisma.invoice.findFirst({
      where: { id: args.id, ownerId: ctx.ownerId },
      select: {
        id: true,
        vendorName: true,
        invoiceNumber: true,
        invoiceDate: true,
        storeId: true,
        status: true,
        subtotal: true,
        taxAmount: true,
        totalAmount: true,
        store: { select: { name: true } },
        lineItems: {
          orderBy: { lineNumber: "asc" },
          select: {
            id: true,
            lineNumber: true,
            productName: true,
            description: true,
            category: true,
            unit: true,
            quantity: true,
            unitPrice: true,
            extendedPrice: true,
            canonicalIngredient: { select: { name: true } },
          },
        },
      },
    })
    if (!inv) return null

    return {
      invoiceId: inv.id,
      vendor: inv.vendorName,
      invoiceNumber: inv.invoiceNumber,
      date: inv.invoiceDate ? ymd(inv.invoiceDate) : null,
      storeId: inv.storeId,
      storeName: inv.store?.name ?? null,
      status: inv.status,
      subtotal: inv.subtotal,
      taxAmount: inv.taxAmount,
      totalAmount: inv.totalAmount,
      lineCount: inv.lineItems.length,
      lines: inv.lineItems.map((l) => ({
        lineId: l.id,
        lineNumber: l.lineNumber,
        productName: l.productName,
        description: l.description,
        category: l.category,
        unit: l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        extendedPrice: l.extendedPrice,
        canonicalIngredient: l.canonicalIngredient?.name ?? null,
      })),
    }
  },
}

const sumParams = z
  .object({
    lineIds: z.array(z.string().min(1)).min(1).max(500),
  })
  .strict()

export type SumInvoiceLinesResult = {
  totalAmount: number
  byVendor: Array<{ vendor: string; amount: number; lineCount: number }>
  byMonth: Array<{ month: string; amount: number; lineCount: number }>
  /** Number of input lineIds that didn't resolve to a row owned by this user. */
  unresolved: number
}

export const sumInvoiceLines: ChatTool<typeof sumParams, SumInvoiceLinesResult> = {
  name: "sumInvoiceLines",
  description:
    "Totals a set of invoice line ids — typically the lineIds returned by searchInvoices — and rolls them up by vendor and by month. Owner-scoped: line items not owned by the caller are silently dropped and counted as 'unresolved'.",
  parameters: sumParams,
  async execute(args, ctx) {
    const lines = await ctx.prisma.invoiceLineItem.findMany({
      where: {
        id: { in: args.lineIds },
        invoice: { ownerId: ctx.ownerId },
      },
      select: {
        id: true,
        extendedPrice: true,
        invoice: {
          select: { vendorName: true, invoiceDate: true },
        },
      },
    })

    const unresolved = args.lineIds.length - lines.length

    const vendorMap = new Map<string, { amount: number; lineCount: number }>()
    const monthMap = new Map<string, { amount: number; lineCount: number }>()
    let total = 0

    for (const l of lines) {
      total += l.extendedPrice
      const v = vendorMap.get(l.invoice.vendorName) ?? {
        amount: 0,
        lineCount: 0,
      }
      v.amount += l.extendedPrice
      v.lineCount += 1
      vendorMap.set(l.invoice.vendorName, v)

      const month = l.invoice.invoiceDate
        ? l.invoice.invoiceDate.toISOString().slice(0, 7)
        : "unknown"
      const m = monthMap.get(month) ?? { amount: 0, lineCount: 0 }
      m.amount += l.extendedPrice
      m.lineCount += 1
      monthMap.set(month, m)
    }

    return {
      totalAmount: total,
      byVendor: Array.from(vendorMap.entries())
        .map(([vendor, v]) => ({ vendor, ...v }))
        .sort((a, b) => b.amount - a.amount),
      byMonth: Array.from(monthMap.entries())
        .map(([month, v]) => ({ month, ...v }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      unresolved,
    }
  },
}
