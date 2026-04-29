import { z } from "zod"
import { assertOwnerOwnsStores } from "@/lib/chat/owner-scope"
import type { ChatToolContext } from "./types"

/** Inclusive date range as `YYYY-MM-DD` strings. The model produces these
 * deterministically, the tool parses to JS Dates with the day boundary at
 * UTC 00:00. All Otter summary tables store dates with `@db.Date`, so UTC
 * midnight is the canonical comparison instant. */
export const dateRangeSchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
  })
  .strict()

export type DateRangeInput = z.infer<typeof dateRangeSchema>

export function parseDateRange(input: DateRangeInput): { from: Date; to: Date } {
  const from = new Date(`${input.from}T00:00:00.000Z`)
  const to = new Date(`${input.to}T00:00:00.000Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error("invalid date in dateRange")
  }
  if (from > to) throw new Error("dateRange.from must be on or before dateRange.to")
  return { from, to }
}

/** Optional `storeIds` array: every chat tool defaults to "all owned stores"
 * when the model omits the field. The owner-scope helper expands an empty
 * array to the full list and rejects any foreign id. */
export const storeIdsSchema = z
  .array(z.string().min(1))
  .optional()
  .describe(
    "Restrict to these store ids. Resolve names through listStores first. Omit to scope to every store the owner runs.",
  )

export async function resolveStoreIds(
  ctx: ChatToolContext,
  requested: string[] | undefined,
): Promise<string[]> {
  return assertOwnerOwnsStores(ctx.accountId, requested ?? null)
}

/** Format a Date as `YYYY-MM-DD` in UTC — matches `@db.Date` semantics. */
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}
