"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { convertNativeToRecipeQty } from "@/lib/inventory/unit-conversion"
import { applyCalibrationUpdatesForCount } from "@/lib/inventory/calibration-update"

interface SessionUser {
  id: string
  accountId: string
}
interface SessionLike {
  user?: SessionUser | null
}

async function requireSession(): Promise<SessionUser | null> {
  const session = (await getServerSession(authOptions)) as SessionLike | null
  return session?.user ?? null
}

async function loadStoreIdsForAccount(accountId: string): Promise<string[]> {
  const stores = await prisma.store.findMany({
    where: { accountId },
    select: { id: true },
  })
  return stores.map((s) => s.id)
}

// ---------------------------------------------------------------------------
// createStockCount
// ---------------------------------------------------------------------------

export type CreateStockCountResult =
  | { ok: true; stockCountId: string }
  | { ok: false; error: "store_not_in_account" }
  | { ok: false; error: "in_progress_count_exists"; existingCountId: string }

export async function createStockCount(input: {
  storeId: string
  countedAt: Date
  note?: string | null
}): Promise<CreateStockCountResult | null> {
  const user = await requireSession()
  if (!user) return null

  const storeIds = await loadStoreIdsForAccount(user.accountId)
  if (!storeIds.includes(input.storeId)) {
    return { ok: false, error: "store_not_in_account" }
  }

  const existing = await prisma.stockCount.findFirst({
    where: { storeId: input.storeId, status: "IN_PROGRESS" },
    select: { id: true },
  })
  if (existing) {
    return { ok: false, error: "in_progress_count_exists", existingCountId: existing.id }
  }

  const created = await prisma.stockCount.create({
    data: {
      storeId: input.storeId,
      countedByUserId: user.id,
      countedAt: input.countedAt,
      status: "IN_PROGRESS",
      note: input.note ?? null,
    },
    select: { id: true },
  })
  return { ok: true, stockCountId: created.id }
}

// ---------------------------------------------------------------------------
// saveStockCountLine
// ---------------------------------------------------------------------------

export type SaveStockCountLineResult =
  | { ok: true; lineId: string; qtyInRecipeUnit: number }
  | { ok: false; error: "count_not_found" }
  | { ok: false; error: "count_not_in_account" }
  | { ok: false; error: "count_not_in_progress" }
  | { ok: false; error: "ingredient_not_found" }
  | { ok: false; error: "ingredient_not_in_account" }
  | { ok: false; error: "ingredient_missing_recipe_unit" }
  | { ok: false; error: "invalid_qty" }
  | { ok: false; error: "invalid_unit" }
  | { ok: false; error: "missing_conversion"; fromUnit: string; toUnit: string }

export async function saveStockCountLine(input: {
  stockCountId: string
  canonicalIngredientId: string
  nativeQty: number
  nativeUnit: string
  note?: string | null
  estimatedQtyAtCount?: number | null
  calibrationFactorAtCount?: number | null
}): Promise<SaveStockCountLineResult | null> {
  const user = await requireSession()
  if (!user) return null

  if (!Number.isFinite(input.nativeQty) || input.nativeQty < 0) {
    return { ok: false, error: "invalid_qty" }
  }

  const count = await prisma.stockCount.findUnique({
    where: { id: input.stockCountId },
    select: { id: true, storeId: true, status: true, store: { select: { accountId: true } } },
  })
  if (!count) return { ok: false, error: "count_not_found" }
  if (count.store.accountId !== user.accountId) return { ok: false, error: "count_not_in_account" }
  if (count.status !== "IN_PROGRESS") return { ok: false, error: "count_not_in_progress" }

  const ingredient = await prisma.canonicalIngredient.findUnique({
    where: { id: input.canonicalIngredientId },
    select: { id: true, accountId: true, recipeUnit: true },
  })
  if (!ingredient) return { ok: false, error: "ingredient_not_found" }
  if (ingredient.accountId !== user.accountId) return { ok: false, error: "ingredient_not_in_account" }
  if (!ingredient.recipeUnit) return { ok: false, error: "ingredient_missing_recipe_unit" }

  // Pull all conversion entries for this canonical ingredient so we can pick
  // the matching (fromUnit, toUnit) pair.
  const skuMatches = await prisma.ingredientSkuMatch.findMany({
    where: { canonicalIngredientId: ingredient.id },
    select: { fromUnit: true, toUnit: true, conversionFactor: true },
  })
  const conversions = skuMatches.map((m) => ({
    fromUnit: m.fromUnit,
    toUnit: m.toUnit,
    factor: m.conversionFactor,
  }))

  const conversion = convertNativeToRecipeQty({
    nativeQty: input.nativeQty,
    nativeUnit: input.nativeUnit,
    recipeUnit: ingredient.recipeUnit,
    conversions,
  })
  if (!conversion.ok) {
    if (conversion.reason === "invalid_qty") return { ok: false, error: "invalid_qty" }
    if (conversion.reason === "invalid_unit") return { ok: false, error: "invalid_unit" }
    return {
      ok: false,
      error: "missing_conversion",
      fromUnit: conversion.fromUnit ?? input.nativeUnit,
      toUnit: conversion.toUnit ?? ingredient.recipeUnit,
    }
  }

  const upserted = await prisma.stockCountLine.upsert({
    where: {
      stockCountId_canonicalIngredientId: {
        stockCountId: input.stockCountId,
        canonicalIngredientId: input.canonicalIngredientId,
      },
    },
    create: {
      stockCountId: input.stockCountId,
      canonicalIngredientId: input.canonicalIngredientId,
      qtyInRecipeUnit: conversion.qtyInRecipeUnit,
      nativeQty: input.nativeQty,
      nativeUnit: input.nativeUnit,
      note: input.note ?? null,
      estimatedQtyAtCount: input.estimatedQtyAtCount ?? null,
      calibrationFactorAtCount: input.calibrationFactorAtCount ?? null,
    },
    update: {
      qtyInRecipeUnit: conversion.qtyInRecipeUnit,
      nativeQty: input.nativeQty,
      nativeUnit: input.nativeUnit,
      note: input.note ?? null,
      estimatedQtyAtCount: input.estimatedQtyAtCount ?? null,
      calibrationFactorAtCount: input.calibrationFactorAtCount ?? null,
    },
    select: { id: true },
  })

  return { ok: true, lineId: upserted.id, qtyInRecipeUnit: conversion.qtyInRecipeUnit }
}

// ---------------------------------------------------------------------------
// completeStockCount
// ---------------------------------------------------------------------------

export type CompleteStockCountResult =
  | { ok: true }
  | { ok: false; error: "count_not_found" }
  | { ok: false; error: "count_not_in_account" }
  | { ok: false; error: "count_not_in_progress" }

export async function completeStockCount(input: {
  stockCountId: string
}): Promise<CompleteStockCountResult | null> {
  const user = await requireSession()
  if (!user) return null

  const count = await prisma.stockCount.findUnique({
    where: { id: input.stockCountId },
    select: { id: true, status: true, store: { select: { accountId: true } } },
  })
  if (!count) return { ok: false, error: "count_not_found" }
  if (count.store.accountId !== user.accountId) return { ok: false, error: "count_not_in_account" }
  if (count.status !== "IN_PROGRESS") return { ok: false, error: "count_not_in_progress" }

  // Run calibration update BEFORE marking complete, so the running-on-hand
  // anchor query (which filters status=COMPLETED) still picks the previous
  // count rather than this one.
  await applyCalibrationUpdatesForCount(input.stockCountId)

  await prisma.stockCount.update({
    where: { id: input.stockCountId },
    data: { status: "COMPLETED", completedAt: new Date() },
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// listStockCounts
// ---------------------------------------------------------------------------

export interface StockCountSummary {
  id: string
  storeId: string
  status: string
  countedAt: Date
  completedAt: Date | null
  note: string | null
}

export async function listStockCounts(options?: {
  storeId?: string
  limit?: number
}): Promise<StockCountSummary[] | null> {
  const user = await requireSession()
  if (!user) return null

  const accountStoreIds = await loadStoreIdsForAccount(user.accountId)
  const targetStoreIds =
    options?.storeId && accountStoreIds.includes(options.storeId)
      ? [options.storeId]
      : accountStoreIds

  if (targetStoreIds.length === 0) return []

  const rows = await prisma.stockCount.findMany({
    where: { storeId: { in: targetStoreIds } },
    orderBy: { countedAt: "desc" },
    take: options?.limit ?? 50,
    select: {
      id: true,
      storeId: true,
      status: true,
      countedAt: true,
      completedAt: true,
      note: true,
    },
  })
  return rows as StockCountSummary[]
}
