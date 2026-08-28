import { cache } from "react"
import { prisma } from "@/lib/prisma"

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
 * `getStores()`'s whole-row equivalent therefore lives in
 * `src/app/actions/store/crud-actions.ts` as a module-local `cache()`d const,
 * next to the session it already resolves, rather than here. It stays whole-row
 * because `getStores` has twenty-three callers across the editorial tree that
 * may read any column; narrowing that return type is a separate change with a
 * much wider blast radius.
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
 * The columns Counter's loaders read. Deliberately a UNION of what
 * `loadChannelMix` and `loadStripTargets` each select rather than a whole
 * row: one query serves both, and adding a column here is a decision someone
 * makes on purpose instead of `select`-less drift.
 */
export interface AccountStore {
  id: string
  name: string
  /** Nullable in the schema — an unset food-cost plan. */
  targetCogsPct: number | null
  uberCommissionRate: number
  doordashCommissionRate: number
}

export const getAccountStores = cache(
  async (accountId: string): Promise<AccountStore[]> =>
    prisma.store.findMany({
      where: { accountId, isActive: true },
      select: {
        id: true,
        name: true,
        targetCogsPct: true,
        uberCommissionRate: true,
        doordashCommissionRate: true,
      },
      orderBy: { name: "asc" },
    }),
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
