import type { LifecycleStage } from "@/generated/prisma/client"

/**
 * Shared reading of `Store.lifecycleStage`.
 *
 * Today and P&L already treat pre-open stores correctly ("PRE-OPEN · NO SERVICE
 * YET", "1 operational · 2 pre-open"), but Inventory defaulted its store picker
 * to whichever store sorted first — a store under construction — and rendered
 * 76 ingredients of `NO SIGNAL`, while COGS and the Stores directory showed the
 * same stores as "clean" and "ACTIVE". These helpers give every surface one
 * definition so a store that has never served a customer never reads as healthy.
 */

/** Anything carrying a lifecycle stage — Store rows, COGS overview rows, etc. */
export interface StoreLifecycleLike {
  lifecycleStage: LifecycleStage
}

/** A store that is trading, or at least expected to have data. */
export function isOperational(store: StoreLifecycleLike): boolean {
  return store.lifecycleStage !== "pre_open"
}

/**
 * The store an operator means when they haven't named one: the first that is
 * actually trading. Falls back to the first store overall so a fresh account
 * (every store still pre-open) still renders something rather than redirecting.
 */
export function pickDefaultStore<T extends StoreLifecycleLike>(
  stores: T[],
): T | undefined {
  return stores.find(isOperational) ?? stores[0]
}

export function partitionByLifecycle<T extends StoreLifecycleLike>(
  stores: T[],
): { operational: T[]; preOpen: T[] } {
  const operational: T[] = []
  const preOpen: T[] = []
  for (const s of stores) (isOperational(s) ? operational : preOpen).push(s)
  return { operational, preOpen }
}

export const LIFECYCLE_LABEL: Record<LifecycleStage, string> = {
  pre_open: "Pre-open",
  warming_up: "Warming up",
  ready: "Trading",
}

/**
 * Short caption for a mixed list, e.g. "1 operational · 2 pre-open". Returns
 * null when every store is trading, so the caption only appears when it says
 * something.
 */
export function lifecycleSummary(stores: StoreLifecycleLike[]): string | null {
  const { operational, preOpen } = partitionByLifecycle(stores)
  if (preOpen.length === 0) return null
  return `${operational.length} operational · ${preOpen.length} pre-open`
}
