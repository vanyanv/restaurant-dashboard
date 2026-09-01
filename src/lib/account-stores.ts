import { cache } from "react"
import { prisma } from "@/lib/prisma"
import type { Store } from "@/generated/prisma/client"

/**
 * The account's store list, resolved ONCE per request.
 *
 * ## Why this exists
 *
 * A Counter page fans out nine or more concurrent loaders, and most of them
 * need the same fact: which stores are on this account. Before this module
 * each one asked the database itself. Measured on a warm-cache render of
 * `/dashboard/pnl` (Prisma query log, dev server), one page produced **ten**
 * `Store` queries carrying the identical predicate
 * `accountId = $1 AND isActive = $2`, differing only in their `select`:
 *
 *   x3  every column, ordered by createdAt   <- getStores()
 *   x2  { id, name }
 *   x1  { id, targetCogsPct }                <- loadStripTargets
 *   x1  { id, uber…, doordash… }             <- loadChannelMix
 *   x1  { id, uber…, doordash… } + id =      <- loadChannelMix, per store
 *   x1  { id }
 *   x1  a join behind an OtterRating read
 *
 * That cost is paid on EVERY render, warm cache or cold: the Redis rollup
 * cache wraps `getAllStoresPnL`, so it hides the rollup's own store query and
 * none of these. React's `cache()` collapses them per request instead.
 *
 * ## THIS MODULE TAKES AN accountId AND NEVER RESOLVES A SESSION
 *
 * That is a hard constraint, not a style choice. `src/lib/counter/targets.ts`
 * records the reason on `loadStripTargets` — importing `@/lib/auth` pulls
 * `@/lib/prisma` in at MODULE LOAD and takes every importer down without a
 * `DATABASE_URL`, tests included — and `loadChannelMix` and the Overview
 * adapter take an accountId for the same reason. A session-resolving helper
 * added here would put `@/lib/auth` behind all three of them.
 *
 * `getStores()` therefore keeps its own `cache()`d wrapper in
 * `src/app/actions/store/crud-actions.ts`, next to the session it resolves —
 * but the QUERY underneath it is now the one below. It reads the account's
 * rows from here and applies its own `isActive` filter and `createdAt desc`
 * ordering, which is what it always meant; what it no longer does is ask the
 * database a second time for rows another helper had already fetched.
 *
 * ## Scope
 *
 * `cache()` is per-request and every caller here is request-scoped: no cron
 * route and no script imports this module or the loaders that use it
 * (verified before this module was written). Keep it that way — outside a
 * request React's cache does not memoise at all (measured on React 19.2.8:
 * three calls, three invocations), so a batch caller silently gets the old
 * N-query behaviour back with no error to notice. The same property is what
 * makes this safe: nothing is retained between requests, so one account's
 * store list can never be served to another.
 */

/**
 * A store row, whole.
 *
 * This was a hand-written union of the five columns `loadChannelMix` and
 * `loadStripTargets` each selected, on the reasoning that a narrow `select` is
 * a decision rather than drift. That reasoning applied when this module ran
 * its own query. It no longer does: `getAccountStoreRows` fetches whole rows
 * because `getStoresCached`'s twenty-three callers may read any column, and
 * every helper here reads from that one result. A narrower TYPE over wider
 * DATA is not a saving — it is a description that is not true, and it sent
 * four callers (the chat owner scope, the COGS lifecycle read, the mobile
 * fixed-expense snapshot) back to the database for columns they already had.
 */
export type AccountStore = Store

/**
 * THE store query. One per request per account, whole rows, every store.
 *
 * ## Why whole rows, and why inactive ones too
 *
 * Because a projection is what split this into four queries in the first
 * place. `cache()` memoises per function, so four helpers each holding their
 * own `store.findMany` — this module's five columns, `getStoresCached`'s whole
 * rows, `resolveStoreContext`'s `{id,name}`, `resolveStoreScope`'s `{id}` —
 * were four round trips for the same three rows. Measured with
 * `PRISMA_TRACE=1` over every route, `Store.findMany` ran between one and SIX
 * times on every page in the product, `/dashboard/forbidden` included.
 *
 * A shared query can only collapse them if it is a superset of all four, so
 * this one drops both narrowing dimensions:
 *
 * - **No `select`.** Whole rows, as `getStoresCached` needs — its twenty-three
 *   callers may read any column.
 * - **No `isActive` filter.** `resolveStoreScope` deliberately counts inactive
 *   stores (an order belonging to a closed store is still that account's
 *   order), while the other three deliberately exclude them. A shared query
 *   that filtered would silently change the first; each caller applies its own
 *   predicate below, so all four keep the contract they had.
 *
 * The cost of the widening is a handful of columns on a handful of rows —
 * this account has three stores — against three saved round trips per page.
 */
export const getAccountStoreRows = cache(
  async (accountId: string) =>
    prisma.store.findMany({
      where: { accountId },
      orderBy: { name: "asc" },
    }),
)

export const getAccountStores = cache(
  async (accountId: string): Promise<AccountStore[]> => {
    const rows = await getAccountStoreRows(accountId)
    // `isActive` and the `name asc` order are this function's own contract, and
    // both are preserved exactly: the shared query already sorts by name, and
    // filtering here is what the `where` used to do.
    return rows.filter((s) => s.isActive)
  },
)

/**
 * The account's stores, narrowed to one when `storeId` is set.
 *
 * Returns an EMPTY array for a `storeId` that is not on the account — the
 * same contract the per-loader queries had, where the `id` filter simply
 * matched nothing. That is load-bearing: `loadChannelMix`'s own comment
 * records it as "a storeId that is not on this account resolves to no
 * stores, not to the whole account", and a page must not answer a question
 * about someone else's store by quietly widening to the whole account.
 */
export async function getScopedStores(
  accountId: string,
  storeId: string | null,
): Promise<AccountStore[]> {
  const all = await getAccountStores(accountId)
  return storeId === null ? all : all.filter((s) => s.id === storeId)
}
