import { cache } from "react"
import { getServerSession } from "next-auth"
import type { Session } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

/**
 * Resolved authentication scope: who is making the request (ownerId, used
 * for audit/who-created-this rows) and which tenant they belong to
 * (accountId, used for every read/write filter).
 *
 * Use this instead of reading session.user.id directly when you need to
 * scope a Prisma query — `accountId` is the access boundary; `ownerId` is
 * just the actor.
 */
export type AuthScope = {
  ownerId: string
  accountId: string
}

/**
 * THE sign-in check. Every server action, loader and guard below reads the
 * session through this one function, once per request (`cache`), so there is
 * one place that decides who is signed in. `tests/lib/server-action-guards.test.ts`
 * fails if a server action is added that never reaches it.
 */
export const getSession = cache(async (): Promise<Session | null> => getServerSession(authOptions))

export async function getAuthScope(): Promise<AuthScope | null> {
  const session = await getSession()
  if (!session?.user) return null
  return { ownerId: session.user.id, accountId: session.user.accountId }
}

export async function requireAuthScope(): Promise<AuthScope> {
  const scope = await getAuthScope()
  if (!scope) throw new Error("Not authenticated")
  return scope
}

/** Full session user (id, email, name, role, accountId) or null. */
export async function getSessionUser(): Promise<Session["user"] | null> {
  const session = await getSession()
  return session?.user ?? null
}

/**
 * Throwing guard for owner-level, store-scoped actions: requires a session,
 * owner access (OWNER or DEVELOPER), and that the store belongs to the
 * caller's account. Error messages ("Unauthorized" / "Forbidden" /
 * "Store not found") are part of the contract — callers surface them.
 */
export async function requireOwnerStore(
  storeId: string
): Promise<{ id: string; name: string }> {
  const session = await getSession()
  if (!session?.user) throw new Error("Unauthorized")
  if (!hasOwnerAccess(session.user.role)) throw new Error("Forbidden")
  const store = await prisma.store.findFirst({
    where: { id: storeId, accountId: session.user.accountId },
    select: { id: true, name: true },
  })
  if (!store) throw new Error("Store not found")
  return store
}
