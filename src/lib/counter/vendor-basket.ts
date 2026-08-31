import { prisma } from "@/lib/prisma"
import { normalizeVendorName } from "@/lib/vendor-normalize"

/**
 * One vendor's basket median, week by week — computed ONCE for the two pages
 * that print it.
 *
 * This is CLAUDE.md's shared-figure rule made concrete: "a figure shown on two
 * pages comes from one function in `src/lib/counter/`". The vendors LIST has
 * printed this since it was built (its trend column, its chart, and the
 * "getting dearer" worklist item all read it), and `P.vendor`'s strip asks for
 * it too — "Basket price · ▲ 12% · 30 days". The vendor DETAIL page could not
 * carry that cell without either recomputing the figure in a second adapter or
 * doing this, and the manifest recorded the choice as open rather than guess.
 * The rule decides it: one function, two callers.
 *
 * ## Why a median of unit prices, and why indexed to the vendor's own week one
 *
 * A vendor's basket is not a fixed shopping list — what arrives varies week to
 * week — so an absolute average moves when the MIX moves, not only when prices
 * do. The median of every line's unit price is the sturdiest single number a
 * varying basket yields, and indexing each vendor to its own first week is
 * what makes two vendors comparable on one axis: Individual FoodService's
 * basket sits at a different absolute level from Sysco's, and drawing them
 * unindexed compares the size of their cases rather than the direction of
 * their prices.
 *
 * It is a DIRECTION, not a price. A vendor whose basket median rises 12% may
 * have raised prices or may have delivered dearer things; this figure says
 * something changed and where to look, and the basket table on the vendor page
 * is what says which items.
 */

/** Weeks the trend covers. The list's chart draws all of them. */
export const BASKET_WEEKS = 8

/** Below this, a move reads "flat" rather than a direction. */
export const BASKET_FLAT_PCT = 2

export interface VendorBasketWeek {
  /** ISO date of the week's Monday. */
  week: string
  /** The normalized vendor name — spellings are already folded. */
  vendor: string
  /** Percent above or below that vendor's own first week in the window. */
  index: number
}

export interface VendorBasketTrends {
  /** The chart's own series, indexed per vendor. */
  weekly: VendorBasketWeek[]
  /** First week to last, per normalized vendor name. Null under two weeks. */
  trend: Map<string, number | null>
}

/**
 * The raw weekly medians. Exported so a caller that already has them (the
 * list, which fetches them alongside its invoices in one `Promise.all`) can
 * hand them straight to `foldBasketTrends` instead of querying twice.
 */
export async function loadVendorBasketWeeks(input: {
  accountId: string
  today: Date
}): Promise<Array<{ wk: Date; vendor: string; px: number }>> {
  return prisma.$queryRaw<Array<{ wk: Date; vendor: string; px: number }>>`
    SELECT DATE_TRUNC('week', i."invoiceDate")::date AS wk, i."vendorName" AS vendor,
           (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY li."unitPrice"))::float AS px
    FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
    WHERE i."accountId" = ${input.accountId} AND li."unitPrice" > 0
      AND i."invoiceDate" >= DATE_TRUNC('week', ${input.today}::date) - MAKE_INTERVAL(weeks => ${BASKET_WEEKS - 1})
    GROUP BY 1, 2 ORDER BY 1`
}

/**
 * Fold the raw weeks onto normalized vendor names and index each to its own
 * first week.
 *
 * A vendor whose folded spellings BOTH delivered in one week yields two rows
 * for that week; they are averaged so the series has one point per week. That
 * is not a rounding convenience — without it a vendor billing under two names
 * draws two points at the same x and the line doubles back on itself.
 */
export function foldBasketTrends(
  rows: Array<{ wk: Date; vendor: string; px: number }>,
): VendorBasketTrends {
  const byVendor = new Map<string, Array<{ week: string; px: number }>>()
  for (const w of rows) {
    const name = normalizeVendorName(w.vendor)
    const list = byVendor.get(name) ?? []
    list.push({ week: w.wk.toISOString().slice(0, 10), px: w.px })
    byVendor.set(name, list)
  }

  const weekly: VendorBasketWeek[] = []
  const trend = new Map<string, number | null>()
  for (const [name, vendorRows] of byVendor) {
    const weeks = [...new Set(vendorRows.map((r) => r.week))].sort()
    const at = (w: string) => {
      const hits = vendorRows.filter((r) => r.week === w)
      return hits.reduce((t, r) => t + r.px, 0) / hits.length
    }
    const base = at(weeks[0])
    for (const w of weeks) {
      weekly.push({ week: w, vendor: name, index: base > 0 ? ((at(w) - base) / base) * 100 : 0 })
    }
    const last = at(weeks[weeks.length - 1])
    trend.set(name, weeks.length >= 2 && base > 0 ? ((last - base) / base) * 100 : null)
  }

  return { weekly, trend }
}

/** The whole thing, for a caller with no reason to fetch the weeks itself. */
export async function getVendorBasketTrends(input: {
  accountId: string
  today: Date
}): Promise<VendorBasketTrends> {
  return foldBasketTrends(await loadVendorBasketWeeks(input))
}
