"use server"

import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  InventoryAdjustmentReason,
  StockCountStatus,
} from "@/generated/prisma/client"

type Session = { userId: string; accountId: string }

async function requireSession(): Promise<Session> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id || !session.user.accountId) {
    throw new Error("Unauthorized")
  }
  return { userId: session.user.id, accountId: session.user.accountId }
}

async function requireStore(storeId: string, accountId: string) {
  const store = await prisma.store.findFirst({
    where: { id: storeId, accountId, isActive: true },
    select: { id: true, name: true },
  })
  if (!store) throw new Error("Store not found")
  return store
}

async function requireSessionAndOwnership(sessionId: string) {
  const me = await requireSession()
  const stockCount = await prisma.stockCount.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      storeId: true,
      status: true,
      store: { select: { accountId: true } },
    },
  })
  if (!stockCount) throw new Error("Session not found")
  if (stockCount.store.accountId !== me.accountId) {
    throw new Error("Session not found")
  }
  return { me, stockCount }
}

export type StartStockCountResult = {
  sessionId: string
  storeId: string
  storeName: string
  startedAt: string
}

/**
 * Open a new IN_PROGRESS StockCount for the store. If one is already open the
 * caller can resume it via `getOpenSessionForStore` instead of starting fresh.
 */
export async function startStockCount(input: {
  storeId: string
}): Promise<StartStockCountResult> {
  const me = await requireSession()
  const store = await requireStore(input.storeId, me.accountId)

  const now = new Date()
  const created = await prisma.stockCount.create({
    data: {
      storeId: store.id,
      countedByUserId: me.userId,
      countedAt: now,
      status: StockCountStatus.IN_PROGRESS,
    },
    select: { id: true, startedAt: true },
  })

  revalidatePath("/m/count")
  return {
    sessionId: created.id,
    storeId: store.id,
    storeName: store.name,
    startedAt: created.startedAt.toISOString(),
  }
}

export type SaveCountLineResult = {
  lineId: string
  ingredientId: string
  qty: number
}

/**
 * Upsert a StockCountLine for (sessionId, ingredientId). qty is in the
 * canonical recipe unit. We deliberately leave estimatedQtyAtCount /
 * calibrationFactorAtCount null in cut 1 — those are populated by the
 * downstream calibration job, not the mobile entry surface.
 */
export async function saveCountLine(input: {
  sessionId: string
  ingredientId: string
  qty: number
  /** Audit trail: how the operator typed it (e.g. "1.25 CS" → 1.25, "CS"). */
  nativeQty?: number | null
  nativeUnit?: string | null
}): Promise<SaveCountLineResult> {
  if (!Number.isFinite(input.qty) || input.qty < 0) {
    throw new Error("qty must be a non-negative number")
  }
  if (
    input.nativeQty != null &&
    (!Number.isFinite(input.nativeQty) || input.nativeQty < 0)
  ) {
    throw new Error("nativeQty must be a non-negative number")
  }
  const { me, stockCount } = await requireSessionAndOwnership(input.sessionId)
  if (stockCount.status !== StockCountStatus.IN_PROGRESS) {
    throw new Error("Session is no longer in progress")
  }

  const ingredient = await prisma.canonicalIngredient.findFirst({
    where: { id: input.ingredientId, accountId: me.accountId },
    select: { id: true },
  })
  if (!ingredient) throw new Error("Ingredient not found")

  const nativeQty = input.nativeQty ?? null
  const nativeUnit = input.nativeUnit?.trim() || null

  const upserted = await prisma.stockCountLine.upsert({
    where: {
      stockCountId_canonicalIngredientId: {
        stockCountId: input.sessionId,
        canonicalIngredientId: input.ingredientId,
      },
    },
    create: {
      stockCountId: input.sessionId,
      canonicalIngredientId: input.ingredientId,
      qtyInRecipeUnit: input.qty,
      nativeQty,
      nativeUnit,
    },
    update: {
      qtyInRecipeUnit: input.qty,
      nativeQty,
      nativeUnit,
    },
    select: { id: true },
  })

  return {
    lineId: upserted.id,
    ingredientId: input.ingredientId,
    qty: input.qty,
  }
}

export async function completeStockCount(input: {
  sessionId: string
}): Promise<{ ok: true }> {
  const { stockCount } = await requireSessionAndOwnership(input.sessionId)
  if (stockCount.status !== StockCountStatus.IN_PROGRESS) {
    throw new Error("Session is no longer in progress")
  }

  await prisma.stockCount.update({
    where: { id: input.sessionId },
    data: {
      status: StockCountStatus.COMPLETED,
      completedAt: new Date(),
    },
  })

  revalidatePath("/m/count")
  revalidatePath(`/dashboard/operations`)
  return { ok: true }
}

export async function abandonStockCount(input: {
  sessionId: string
}): Promise<{ ok: true }> {
  const { stockCount } = await requireSessionAndOwnership(input.sessionId)
  if (stockCount.status !== StockCountStatus.IN_PROGRESS) {
    return { ok: true }
  }
  await prisma.stockCount.update({
    where: { id: input.sessionId },
    data: { status: StockCountStatus.ABANDONED },
  })
  revalidatePath("/m/count")
  return { ok: true }
}

export type LogAdjustmentResult = {
  adjustmentId: string
}

export async function logAdjustment(input: {
  storeId: string
  ingredientId: string
  reason: InventoryAdjustmentReason
  qty: number
  notes?: string | null
}): Promise<LogAdjustmentResult> {
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    throw new Error("qty must be positive")
  }
  const me = await requireSession()
  await requireStore(input.storeId, me.accountId)

  const ingredient = await prisma.canonicalIngredient.findFirst({
    where: { id: input.ingredientId, accountId: me.accountId },
    select: { id: true },
  })
  if (!ingredient) throw new Error("Ingredient not found")

  const created = await prisma.inventoryAdjustment.create({
    data: {
      storeId: input.storeId,
      canonicalIngredientId: input.ingredientId,
      occurredAt: new Date(),
      qty: input.qty,
      reason: input.reason,
      note: input.notes ?? null,
      createdByUserId: me.userId,
    },
    select: { id: true },
  })

  revalidatePath(`/dashboard/operations`)
  return { adjustmentId: created.id }
}
