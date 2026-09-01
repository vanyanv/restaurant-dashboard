import { cache } from "react"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getAccountStoreRows } from "@/lib/account-stores"

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
    // One shared store query per request, not one per helper — see
    // `@/lib/account-stores`. Both branches below keep the predicate they had:
    // the scoped one accepts an inactive store (it looked the id up directly
    // and only checked the account), the aggregate one does not.
    const rows = await getAccountStoreRows(accountId)

    if (storeId) {
      const store = rows.find((s) => s.id === storeId)
      // A store on another account and a store that does not exist were always
      // the same answer here — the old lookup fetched by id and then compared
      // `accountId` — and reading from an account-scoped list says it once.
      if (!store) {
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
    const stores = rows.filter((s) => s.isActive)
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
