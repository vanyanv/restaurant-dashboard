"use server"

import { getSessionUser as requireSession } from "@/lib/auth-scope"
import { prisma } from "@/lib/prisma"
import { getAccountStoreRows } from "@/lib/account-stores"
import { convertNativeToRecipeQty } from "@/lib/inventory/unit-conversion"
import { applyCalibrationUpdatesForCount } from "@/lib/inventory/calibration-update"

async function loadStoreIdsForAccount(accountId: string): Promise<string[]> {
  // The one store query a request makes — `@/lib/account-stores`. This caller
  // counts inactive stores too, which is why the shared query does not filter.
  const stores = await getAccountStoreRows(accountId)
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

  // The expectation is the calibration's training target, so it is taken only
  // as a finite number — NaN or Infinity from a hand-rolled caller would be
  // filtered out again by `applyCalibrationUpdatesForCount` and is not worth
  // storing in the meantime.
  const estimate =
    typeof input.estimatedQtyAtCount === "number" && Number.isFinite(input.estimatedQtyAtCount)
      ? input.estimatedQtyAtCount
      : null
  const calibrationFactor =
    typeof input.calibrationFactorAtCount === "number" &&
    Number.isFinite(input.calibrationFactorAtCount)
      ? input.calibrationFactorAtCount
      : null

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
      estimatedQtyAtCount: estimate,
      calibrationFactorAtCount: calibrationFactor,
    },
    // A correction re-saves the SAME line, and it must not be able to erase an
    // expectation already recorded against it. The expectation is anchored to
    // the moment the session opened, so it is write-once per line: a caller
    // that has one sets it, a caller that has none leaves the column alone
    // rather than nulling it. Without this, one stale tab blurring a box
    // silently removes the count's only training signal.
    update: {
      qtyInRecipeUnit: conversion.qtyInRecipeUnit,
      nativeQty: input.nativeQty,
      nativeUnit: input.nativeUnit,
      note: input.note ?? null,
      ...(estimate === null ? {} : { estimatedQtyAtCount: estimate }),
      ...(calibrationFactor === null ? {} : { calibrationFactorAtCount: calibrationFactor }),
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
