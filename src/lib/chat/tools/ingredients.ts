import { z } from "zod"
import { resolveStoreIds, storeIdsSchema, ymd } from "./_shared"
import type { ChatTool } from "./types"

const params = z
  .object({
    query: z
      .string()
      .min(1)
      .describe("Case-insensitive substring match on the canonical ingredient name (e.g. 'cheese', 'chicken thigh')."),
    storeIds: storeIdsSchema,
    limit: z.number().int().min(1).max(25).optional().default(10),
  })
  .strict()

export type IngredientPriceRow = {
  ingredient: string
  /** Recipe unit when set, else the ingredient's default unit. */
  unit: string
  /** Dollars per recipe unit. Null when no cost has been derived yet. */
  currentCost: number | null
  costSource: "manual" | "invoice" | null
  /** Most recent linked invoice's invoice-date in `YYYY-MM-DD`, null if no invoice has linked. */
  lastInvoiceDate: string | null
  vendor: string | null
}

export const getIngredientPrices: ChatTool<typeof params, IngredientPriceRow[]> = {
  name: "getIngredientPrices",
  description:
    "Lookup current cost-per-unit for owner-scoped canonical ingredients, ranked by recency of the last linked invoice. Use this for 'what's the cost of cheese?' / 'how much are we paying for chicken thighs?' style questions. Names short and explicit; ILIKE-based matching, no embeddings.",
  parameters: params,
  async execute(args, ctx) {
    // storeIds is accepted for symmetry with the rest of the surface, but
    // canonical ingredients are owner-level (one per owner), not store-level —
    // the assert ensures the caller can't probe foreign-store scoping.
    await resolveStoreIds(ctx, args.storeIds)

    const canonicals = await ctx.prisma.canonicalIngredient.findMany({
      where: {
        ownerId: ctx.ownerId,
        name: { contains: args.query, mode: "insensitive" },
      },
      select: {
        id: true,
        name: true,
        defaultUnit: true,
        recipeUnit: true,
        costPerRecipeUnit: true,
        costSource: true,
      },
      orderBy: { name: "asc" },
      take: args.limit ?? 10,
    })

    if (canonicals.length === 0) return []

    const results: IngredientPriceRow[] = []
    for (const c of canonicals) {
      const lastLine = await ctx.prisma.invoiceLineItem.findFirst({
        where: {
          canonicalIngredientId: c.id,
          invoice: { ownerId: ctx.ownerId },
        },
        orderBy: { invoice: { invoiceDate: "desc" } },
        select: {
          invoice: {
            select: { vendorName: true, invoiceDate: true },
          },
        },
      })

      const source = c.costSource as IngredientPriceRow["costSource"]
      results.push({
        ingredient: c.name,
        unit: c.recipeUnit ?? c.defaultUnit,
        currentCost: c.costPerRecipeUnit ?? null,
        costSource: source === "manual" || source === "invoice" ? source : null,
        lastInvoiceDate:
          lastLine?.invoice.invoiceDate
            ? ymd(lastLine.invoice.invoiceDate)
            : null,
        vendor: lastLine?.invoice.vendorName ?? null,
      })
    }
    return results
  },
}
