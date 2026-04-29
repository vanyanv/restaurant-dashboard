import { prisma } from "@/lib/prisma"

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
}

/** Returns every active store owned by `ownerId`. Used to inject the store
 * list into the system prompt and to resolve "all my stores" tool calls. */
export async function listOwnerStores(
  ownerId: string,
): Promise<OwnerStoreRow[]> {
  return prisma.store.findMany({
    where: { ownerId, isActive: true },
    select: { id: true, name: true, address: true },
    orderBy: { name: "asc" },
  })
}

/**
 * Confirms every id in `requestedStoreIds` belongs to `ownerId`. Throws
 * `OwnerScopeError("STORE_NOT_OWNED", ...)` on the first mismatch — fail
 * closed, never silently drop. Returns the validated id list (deduped, in
 * the order it was passed) on success.
 *
 * If `requestedStoreIds` is empty or omitted, returns the owner's full list
 * — the convention is "no scope = all my stores".
 */
export async function assertOwnerOwnsStores(
  ownerId: string,
  requestedStoreIds: string[] | null | undefined,
): Promise<string[]> {
  if (!ownerId) {
    throw new OwnerScopeError("UNAUTHORIZED", "missing ownerId")
  }

  const requested = Array.from(new Set(requestedStoreIds ?? []))
  const owned = await prisma.store.findMany({
    where: { ownerId },
    select: { id: true },
  })
  const ownedSet = new Set(owned.map((s) => s.id))

  if (requested.length === 0) {
    if (ownedSet.size === 0) {
      throw new OwnerScopeError(
        "EMPTY_STORE_LIST",
        "owner has no stores",
      )
    }
    return Array.from(ownedSet)
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

/** Render the owner's store list into a compact block for the system
 * prompt. The model uses this to resolve "Bay Ridge" / "the downtown one"
 * back to UUIDs; never put a UUID in the user-facing answer. */
export function renderStoreListForPrompt(stores: OwnerStoreRow[]): string {
  if (stores.length === 0) return "(no active stores)"
  return stores
    .map((s) => `- ${s.name}${s.address ? ` — ${s.address}` : ""} [id: ${s.id}]`)
    .join("\n")
}
