import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

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

export async function getAuthScope(): Promise<AuthScope | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  return { ownerId: session.user.id, accountId: session.user.accountId }
}

export async function requireAuthScope(): Promise<AuthScope> {
  const scope = await getAuthScope()
  if (!scope) throw new Error("Not authenticated")
  return scope
}
