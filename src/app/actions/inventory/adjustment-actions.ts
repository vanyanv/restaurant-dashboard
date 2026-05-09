"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { InventoryAdjustmentReason } from "@/generated/prisma/client"

interface SessionUser {
  id: string
  accountId: string
}
interface SessionLike {
  user?: SessionUser | null
}

export type AdjustmentReason = keyof typeof InventoryAdjustmentReason

export type LogInventoryAdjustmentResult =
  | { ok: true; adjustmentId: string }
  | { ok: false; error: "invalid_qty" }
  | { ok: false; error: "store_not_in_account" }
  | { ok: false; error: "ingredient_not_found" }
  | { ok: false; error: "ingredient_not_in_account" }

export async function logInventoryAdjustment(input: {
  storeId: string
  canonicalIngredientId: string
  qty: number
  reason: AdjustmentReason
  note?: string | null
  occurredAt?: Date
}): Promise<LogInventoryAdjustmentResult | null> {
  const session = (await getServerSession(authOptions)) as SessionLike | null
  const user = session?.user ?? null
  if (!user) return null

  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    return { ok: false, error: "invalid_qty" }
  }

  const store = await prisma.store.findUnique({
    where: { id: input.storeId },
    select: { id: true, accountId: true },
  })
  if (!store || store.accountId !== user.accountId) {
    return { ok: false, error: "store_not_in_account" }
  }

  const ingredient = await prisma.canonicalIngredient.findUnique({
    where: { id: input.canonicalIngredientId },
    select: { id: true, accountId: true },
  })
  if (!ingredient) return { ok: false, error: "ingredient_not_found" }
  if (ingredient.accountId !== user.accountId) {
    return { ok: false, error: "ingredient_not_in_account" }
  }

  const created = await prisma.inventoryAdjustment.create({
    data: {
      storeId: input.storeId,
      canonicalIngredientId: input.canonicalIngredientId,
      qty: input.qty,
      reason: input.reason,
      note: input.note ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      createdByUserId: user.id,
    },
    select: { id: true },
  })

  return { ok: true, adjustmentId: created.id }
}
