// Centralizes the "load all stores for the session's account, then optionally
// narrow to a single storeId" preamble that appears verbatim in many server
// actions. Returns null when there is no session/user; callers decide what
// the empty-stores case means (null vs []) for their own return shape.

import { getAccountStoreRows } from "@/lib/account-stores"

interface SessionLike {
  user?: { accountId: string; id: string } | null
}

export interface StoreScope {
  storeIds: string[]
  targetStoreIds: string[]
}

export async function resolveStoreScope(
  session: SessionLike | null | undefined,
  storeId: string | undefined
): Promise<StoreScope | null> {
  if (!session?.user) return null

  // Every store on the account, ACTIVE OR NOT — the predicate this function
  // has always used, and it is deliberate: an order or an invoice belonging to
  // a closed store is still the account's. `getAccountStoreRows` applies no
  // `isActive` filter of its own for exactly this caller, so the one shared
  // store query a request makes serves this and the three helpers that do
  // filter. See `@/lib/account-stores`.
  const stores = await getAccountStoreRows(session.user.accountId)
  const storeIds = stores.map((s) => s.id)
  const targetStoreIds = storeId ? [storeId] : storeIds
  return { storeIds, targetStoreIds }
}
