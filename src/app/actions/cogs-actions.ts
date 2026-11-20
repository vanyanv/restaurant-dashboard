// Server-only, not a server action: nothing in the browser calls these, so
// they are plain functions and cannot be invoked from outside the server.
// Browser saves go through `src/lib/counter/actions/`.
import "server-only"
import { getSession } from "@/lib/auth-scope"
import { revalidatePath } from "next/cache"
import { hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export interface SetTargetInput {
  storeId: string
  /** Percent value (e.g. 28.5) or null to clear. */
  targetCogsPct: number | null
}

export type SetTargetResult =
  | { ok: true; targetCogsPct: number | null }
  | { error: string }

export async function setStoreTargetCogsPct(
  input: SetTargetInput
): Promise<SetTargetResult> {
  const session = await getSession()
  if (!session) return { error: "Not signed in" }
  if (!hasOwnerAccess(session.user.role)) return { error: "Forbidden" }

  let value: number | null = null
  if (input.targetCogsPct !== null) {
    const v = Number(input.targetCogsPct)
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return { error: "Target must be between 0 and 100." }
    }
    value = Math.round(v * 10) / 10
  }

  const store = await prisma.store.findFirst({
    where: { id: input.storeId, accountId: session.user.accountId },
    select: { id: true },
  })
  if (!store) return { error: "Store not found" }

  await prisma.store.update({
    where: { id: store.id },
    data: { targetCogsPct: value },
  })

  revalidatePath(`/dashboard/cogs/${store.id}`)
  revalidatePath(`/dashboard/cogs`)
  return { ok: true, targetCogsPct: value }
}

/**
 * The store's labor target, a percent of sales (28 = 28%) or null to clear.
 * Same gate, same account scoping and same rounding as the food-cost target.
 */
export async function setStoreTargetLaborPct(input: {
  storeId: string
  targetLaborPct: number | null
}): Promise<{ ok: true; targetLaborPct: number | null } | { error: string }> {
  const session = await getSession()
  if (!session) return { error: "Not signed in" }
  if (!hasOwnerAccess(session.user.role)) return { error: "Forbidden" }

  let value: number | null = null
  if (input.targetLaborPct !== null) {
    const v = Number(input.targetLaborPct)
    if (!Number.isFinite(v) || v <= 0 || v > 100) {
      return { error: "Target must be above 0 and at most 100." }
    }
    value = Math.round(v * 10) / 10
  }

  const store = await prisma.store.findFirst({
    where: { id: input.storeId, accountId: session.user.accountId },
    select: { id: true },
  })
  if (!store) return { error: "Store not found" }

  await prisma.store.update({ where: { id: store.id }, data: { targetLaborPct: value } })

  revalidatePath(`/dashboard/labor`)
  revalidatePath(`/dashboard/labor/${store.id}`)
  return { ok: true, targetLaborPct: value }
}
