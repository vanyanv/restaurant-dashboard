import { prisma } from "@/lib/prisma"
import { getAccountStores } from "@/lib/account-stores"

/**
 * Owner-scope helpers shared by every chat tool. The chat layer never trusts
 * a `storeId` or `ownerId` from the model — every tool resolves the
 * authenticated owner from the route handler context, then runs these
 * checks before any data query.
 *
 * Mirror of the existing dashboard pattern (e.g. `src/app/actions/invoice-actions.ts`)
 * extracted into a reusable helper so a new tool can't accidentally skip the
 * check.
 */

export class OwnerScopeError extends Error {
  readonly code: "UNAUTHORIZED" | "STORE_NOT_OWNED" | "EMPTY_STORE_LIST"
  constructor(
    code: "UNAUTHORIZED" | "STORE_NOT_OWNED" | "EMPTY_STORE_LIST",
    message: string,
  ) {
    super(message)
    this.code = code
  }
}

export interface OwnerStoreRow {
  id: string
  name: string
  address: string | null
  /**
   * `pre_open` | `warming_up` | `ready`. The lifecycle stage decides what the
   * nightly ML job does for a store, and therefore what the assistant is
   * entitled to say about it: a `pre_open` store trains no forecasts at all
   * and a `warming_up` one emits transfer forecasts borrowed from Hollywood.
   * Without this field the chat reported "no forecast available" for a store
   * that was never going to have one, which reads as an outage rather than as
   * a store that has not opened.
   */
  lifecycleStage: string
  /** Null until the store physically opens. */
  openedAt: Date | null
  /**
   * Per-store COGS target as a percent (28.5 = 28.5%). Null when the owner
   * has not set one, and the difference matters: the prompt already tells the
   * model to say the target is not configured rather than guess.
   */
  targetCogsPct: number | null
}

/**
 * Module-scoped cache for the owner store list. Stores change rarely; the
 * chat layer reads this on every turn to render the system prompt and to
 * resolve "all my stores" tool calls. A 60s TTL is short enough that a new
 * store appears within a minute and long enough to make repeat chat turns
 * skip a Postgres round-trip.
 */
const STORE_CACHE_TTL_MS = 60_000
const storeCache = new Map<
  string,
  { stores: OwnerStoreRow[]; expiresAt: number }
>()
const ownedStoreIdsCache = new Map<
  string,
  { ids: string[]; expiresAt: number }
>()

/** Returns every active store on `accountId`. Used to inject the store
 * list into the system prompt and to resolve "all my stores" tool calls. */
export async function listOwnerStores(
  accountId: string,
): Promise<OwnerStoreRow[]> {
  const cached = storeCache.get(accountId)
  if (cached && cached.expiresAt > Date.now()) return cached.stores

  const stores = await getAccountStores(accountId)
  storeCache.set(accountId, {
    stores,
    expiresAt: Date.now() + STORE_CACHE_TTL_MS,
  })
  return stores
}

/** Drop the cached store list for one account. Call after store create/edit/
 * delete mutations so the chat picks up changes within the turn. The
 * parameter is named `ownerId` for backwards compatibility with existing
 * callers; in single-account land it is identical to the accountId for the
 * cache lookup, but to be safe pass either consistently. */
export function invalidateOwnerStoreCache(key: string): void {
  storeCache.delete(key)
  ownedStoreIdsCache.delete(key)
}

/**
 * Confirms every id in `requestedStoreIds` belongs to `accountId`. Throws
 * `OwnerScopeError("STORE_NOT_OWNED", ...)` on the first mismatch — fail
 * closed, never silently drop. Returns the validated id list (deduped, in
 * the order it was passed) on success.
 *
 * If `requestedStoreIds` is empty or omitted, returns the account's full list
 * — the convention is "no scope = all my stores".
 */
export async function assertOwnerOwnsStores(
  accountId: string,
  requestedStoreIds: string[] | null | undefined,
): Promise<string[]> {
  if (!accountId) {
    throw new OwnerScopeError("UNAUTHORIZED", "missing accountId")
  }

  const requested = Array.from(new Set(requestedStoreIds ?? []))
  const owned = await listOwnedStoreIds(accountId)
  const ownedSet = new Set(owned)

  if (requested.length === 0) {
    /*
     * "ALL MY STORES" MEANS THE STORES THE MODEL WAS TOLD ABOUT.
     *
     * The prompt's store block and `listStores` both come from
     * `listOwnerStores`, which filters `isActive`. This default used to come
     * from the unfiltered id list, so an account with a closed store had the
     * model naming three stores and then quietly totalling four. The answer
     * was right about nothing it could explain, and the extra store never
     * appeared in the prose or the provenance line.
     *
     * A deliberate question about a closed store still works: an explicit id
     * is validated against EVERY owned store below, active or not, so
     * "how did Van Nuys do before we shut it?" is answerable. Only the
     * unscoped default narrows.
     */
    const active = (await listOwnerStores(accountId)).map((s) => s.id)
    if (active.length === 0) {
      // Every store closed is not the same as no stores, but neither gives an
      // answer, and the existing error is the one callers already handle.
      throw new OwnerScopeError("EMPTY_STORE_LIST", "owner has no active stores")
    }
    return active
  }

  const missing = requested.filter((id) => !ownedSet.has(id))
  if (missing.length > 0) {
    throw new OwnerScopeError(
      "STORE_NOT_OWNED",
      `store(s) not owned by this user: ${missing.join(", ")}`,
    )
  }
  return requested
}

/**
 * EVERY store on the account, closed ones included.
 *
 * Deliberately wider than `listOwnerStores`: this list decides whether an id
 * the model passed is the account's to read, and a closed store's orders are
 * still that account's orders. The narrowing to active stores happens above,
 * and only for the unscoped default.
 */
async function listOwnedStoreIds(accountId: string): Promise<string[]> {
  const cached = ownedStoreIdsCache.get(accountId)
  if (cached && cached.expiresAt > Date.now()) return cached.ids

  const owned = await prisma.store.findMany({
    where: { accountId },
    select: { id: true },
  })
  const ids = owned.map((s) => s.id)
  ownedStoreIdsCache.set(accountId, {
    ids,
    expiresAt: Date.now() + STORE_CACHE_TTL_MS,
  })
  return ids
}

/** Render the owner's store list into a compact block for the system
 * prompt. The model uses this to resolve "Hollywood" / "Glendale" /
 * "Van Nuys" back to UUIDs; never put a UUID in the user-facing answer. */
export function renderStoreListForPrompt(stores: OwnerStoreRow[]): string {
  if (stores.length === 0) return "(no active stores)"
  return stores
    .map((s) => `- ${s.name}${s.address ? ` — ${s.address}` : ""} [id: ${s.id}]`)
    .join("\n")
}
