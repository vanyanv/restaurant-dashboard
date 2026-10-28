import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"

/**
 * What counts as a PURCHASE when a page sets what was bought against what the
 * recipes say was used — the one rule Product usage and Inventory share.
 *
 * A purchase is an `InvoiceLineItem`:
 *
 * - on an invoice of this `accountId` (the tenancy boundary,
 *   `src/lib/auth-scope.ts`);
 * - on an invoice of a store in view (see "Store scope" below);
 * - whose `invoiceDate` is inside the window, when one is given;
 * - matched to a canonical ingredient (`canonicalIngredientId` not null). An
 *   unmatched line has no ingredient to set against a recipe, so counting it
 *   in a headline that the per-ingredient table cannot show is how the chart
 *   and the headline came to disagree;
 * - on an invoice whose `status` is not `REJECTED`. A rejected invoice is one
 *   the owner said is wrong — bad totals, a duplicate, never should have been
 *   ingested (`setInvoiceReviewDecision`). Setting it against usage would
 *   report a gap the owner has already disowned.
 *
 * Returns and credit memos (`isReturn`) are NOT filtered: their amounts are
 * stored with their natural negative sign (schema comment on
 * `Invoice.isReturn`), so they net out of the sum exactly as they did before
 * this helper existed.
 *
 * ## Store scope
 *
 * - A store picked (`allStores: false`): `storeId` in `storeIds`. An empty
 *   `storeIds` — a `?store=` this account does not own, which
 *   `getScopedStores` resolves to nothing — matches nothing (`AND FALSE`), never
 *   the whole account.
 * - All stores (`allStores: true`): `storeId` in the account's active stores
 *   (the same `storeIds` the theoretical side is filtered by) OR `storeId IS
 *   NULL`. The unassigned-invoice half follows the Operations page
 *   (`adapters/operations.ts`), which applies a store filter only when one is
 *   picked so the all-stores view does not "silently drop every invoice that
 *   was never assigned to one". An unassigned invoice belongs to no store, so
 *   it never shows on a single-store view. The active-store half keeps an
 *   inactive store's deliveries out, because its sales are not on the
 *   theoretical side either. One exception: `Invoice.store` is
 *   `onDelete: SetNull`, so a hard-deleted store's invoices become unassigned
 *   and do show here. Stores are deactivated, not deleted, in practice.
 */
export interface PurchaseScope {
  accountId: string
  storeIds: string[]
  /** True when no store is picked — the account-wide view. */
  allStores: boolean
  /** Inclusive lower bound on `invoiceDate`; omitted means no lower bound. */
  from?: Date | null
  /** Inclusive upper bound on `invoiceDate`; omitted means no upper bound. */
  to?: Date | null
}

function storeScopeSql(scope: PurchaseScope): Prisma.Sql {
  if (scope.storeIds.length === 0) {
    return scope.allStores ? Prisma.sql`AND i."storeId" IS NULL` : Prisma.sql`AND FALSE`
  }
  const ids = Prisma.join(scope.storeIds)
  return scope.allStores
    ? Prisma.sql`AND (i."storeId" IN (${ids}) OR i."storeId" IS NULL)`
    : Prisma.sql`AND i."storeId" IN (${ids})`
}

/**
 * The purchase rule as a raw-SQL condition over `"InvoiceLineItem" li JOIN
 * "Invoice" i ON i.id = li."invoiceId"`. Starts with `TRUE` so it can stand as
 * the whole `WHERE`.
 */
export function purchaseLineFilterSql(scope: PurchaseScope): Prisma.Sql {
  return Prisma.sql`TRUE
    AND i."accountId" = ${scope.accountId}
    ${storeScopeSql(scope)}
    AND li."canonicalIngredientId" IS NOT NULL
    AND i."status" <> 'REJECTED'
    ${scope.from ? Prisma.sql`AND i."invoiceDate" >= ${scope.from}` : Prisma.empty}
    ${scope.to ? Prisma.sql`AND i."invoiceDate" <= ${scope.to}` : Prisma.empty}`
}

/**
 * The same rule as a Prisma `where` on `InvoiceLineItem`, for callers using
 * `aggregate`. Kept beside the SQL form so the two cannot drift.
 */
export function purchaseLineWhere(scope: PurchaseScope): Prisma.InvoiceLineItemWhereInput {
  const storeWhere: Prisma.InvoiceWhereInput =
    scope.storeIds.length === 0
      ? scope.allStores
        ? { storeId: null }
        : { id: { in: [] } }
      : scope.allStores
        ? { OR: [{ storeId: { in: scope.storeIds } }, { storeId: null }] }
        : { storeId: { in: scope.storeIds } }
  const dateWhere: Prisma.DateTimeNullableFilter = {}
  if (scope.from) dateWhere.gte = scope.from
  if (scope.to) dateWhere.lte = scope.to
  return {
    canonicalIngredientId: { not: null },
    invoice: {
      accountId: scope.accountId,
      status: { not: "REJECTED" },
      ...storeWhere,
      ...(scope.from || scope.to ? { invoiceDate: dateWhere } : {}),
    },
  }
}

/** (a) Purchase spend by canonical ingredient. */
export async function purchaseSpendByIngredient(
  scope: PurchaseScope,
): Promise<Array<{ cid: string; spend: number }>> {
  return prisma.$queryRaw<Array<{ cid: string; spend: number }>>`
    SELECT li."canonicalIngredientId" AS cid, SUM(li."extendedPrice")::float AS spend
    FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
    WHERE ${purchaseLineFilterSql(scope)}
    GROUP BY 1`
}

/** (b) Purchase spend by invoice day. */
export async function purchaseSpendByDay(
  scope: PurchaseScope,
): Promise<Array<{ d: Date; v: number }>> {
  return prisma.$queryRaw<Array<{ d: Date; v: number }>>`
    SELECT i."invoiceDate" AS d, SUM(li."extendedPrice")::float AS v
    FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
    WHERE ${purchaseLineFilterSql(scope)} AND i."invoiceDate" IS NOT NULL
    GROUP BY 1 ORDER BY 1`
}
