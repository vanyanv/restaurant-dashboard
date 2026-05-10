import { cache } from "react"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

interface SessionUser {
  id: string
  accountId: string
}
interface SessionLike {
  user?: SessionUser | null
}

export const getCachedSession = cache(
  async (): Promise<SessionLike | null> => {
    return (await getServerSession(authOptions)) as SessionLike | null
  },
)

export interface StoreContext {
  storeIds: string[]
  storeName: string
  /** Single store id when scoped, null in aggregate. */
  storeIdOut: string | null
  /** id → display name. Single entry in scoped mode, all account stores in aggregate. */
  storeNameById: Map<string, string>
}

export type ResolveStoreResult =
  | { ok: true; ctx: StoreContext }
  | { ok: false; error: "store_not_in_account" }

export const resolveStoreContext = cache(
  async (
    storeId: string | undefined,
    accountId: string,
  ): Promise<ResolveStoreResult> => {
    if (storeId) {
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { id: true, name: true, accountId: true },
      })
      if (!store || store.accountId !== accountId) {
        return { ok: false, error: "store_not_in_account" }
      }
      return {
        ok: true,
        ctx: {
          storeIds: [store.id],
          storeName: store.name,
          storeIdOut: store.id,
          storeNameById: new Map([[store.id, store.name]]),
        },
      }
    }
    const stores = await prisma.store.findMany({
      where: { accountId, isActive: true },
      select: { id: true, name: true },
    })
    return {
      ok: true,
      ctx: {
        storeIds: stores.map((s) => s.id),
        storeName: "All stores",
        storeIdOut: null,
        storeNameById: new Map(stores.map((s) => [s.id, s.name])),
      },
    }
  },
)
