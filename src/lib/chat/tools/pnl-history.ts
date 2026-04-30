import { z } from "zod"
import { embed, toVectorLiteral } from "@/lib/chat/embeddings"
import { resolveStoreIds, storeIdsSchema } from "./_shared"
import type { ChatTool } from "./types"

/**
 * Vector search across the owner's weekly P&L narrative snapshots.
 *
 * Use this for historical / contextual questions like "when was COGS last
 * this high?" or "what was our worst-margin week last quarter?". Each row
 * is one (store | all-stores) week with a snapshot of net sales, COGS %,
 * labor %, profit, and top movers folded into the embedded text. Live
 * numbers for the current period come from `getPnlSummary` — never from
 * here.
 */

const params = z
  .object({
    query: z
      .string()
      .min(1)
      .describe(
        "Natural-language question about a past P&L period (e.g. 'when was COGS last above 35%', 'worst margin week last quarter', 'highest sales week this year').",
      ),
    storeIds: storeIdsSchema,
    limit: z.number().int().min(1).max(20).optional().default(5),
  })
  .strict()

export type PnlHistoryRow = {
  weekStart: string
  /** Store name when the snapshot is store-scoped; "All stores" when storeId is null. */
  scope: string
  storeId: string | null
  snapshot: string
  /** Cosine similarity 0..1 — higher is more relevant. */
  score: number
}

export const searchPnlHistory: ChatTool<typeof params, PnlHistoryRow[]> = {
  name: "searchPnlHistory",
  description:
    "Vector search across weekly P&L narrative snapshots. Use for historical / contextual questions ('when was COGS last this high?', 'worst-margin week last quarter'). Returns the top hits with the embedded summary text and a cosine similarity score. Never use this for current-period numbers — call getPnlSummary for those.",
  parameters: params,
  async execute(args, ctx) {
    const requestedStoreIds = await resolveStoreIds(ctx, args.storeIds)
    const vec = await embed(args.query)
    const lit = toVectorLiteral(vec)
    const limit = args.limit ?? 5

    // Match either (a) a store-scoped snapshot for one of the requested
    // stores, or (b) the all-stores rollup for this account. The latter is
    // returned regardless of which storeIds the user named — it carries
    // useful cross-store context.
    const rows = await ctx.prisma.$queryRawUnsafe<
      Array<{
        snapshotId: string
        weekStart: Date
        storeId: string | null
        contentSnapshot: string
        score: number
        storeName: string | null
      }>
    >(
      `SELECT e."snapshotId",
              e."weekStart",
              e."storeId",
              e."contentSnapshot",
              s."name" AS "storeName",
              (1 - (e.embedding <=> $1::vector))::float8 AS score
         FROM "PnlNarrativeEmbedding" e
         LEFT JOIN "Store" s ON s.id = e."storeId"
        WHERE e."accountId" = $2
          AND (e."storeId" IS NULL OR e."storeId" = ANY($3::text[]))
        ORDER BY e.embedding <=> $1::vector
        LIMIT $4`,
      lit,
      ctx.accountId,
      requestedStoreIds,
      limit,
    )

    return rows.map((r) => ({
      weekStart: r.weekStart.toISOString().slice(0, 10),
      scope: r.storeId ? (r.storeName ?? "Unknown store") : "All stores",
      storeId: r.storeId,
      snapshot: r.contentSnapshot,
      score: Number(r.score),
    }))
  },
}
