"use server"

import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
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
  const session = await getServerSession(authOptions)
  if (!session) return { error: "Not signed in" }
  if (session.user.role !== "OWNER") return { error: "Forbidden" }

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
