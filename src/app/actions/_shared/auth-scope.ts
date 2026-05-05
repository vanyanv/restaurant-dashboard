// Centralizes the "load all stores for the session's account, then optionally
// narrow to a single storeId" preamble that appears verbatim in many server
// actions. Returns null when there is no session/user; callers decide what
// the empty-stores case means (null vs []) for their own return shape.

import { prisma } from "@/lib/prisma"

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

  const stores = await prisma.store.findMany({
    where: { accountId: session.user.accountId },
    select: { id: true },
  })
  const storeIds = stores.map((s) => s.id)
  const targetStoreIds = storeId ? [storeId] : storeIds
  return { storeIds, targetStoreIds }
}
