"use server"

import { getServerSession } from "next-auth"
import { revalidatePath } from "next/cache"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  seedCanonicalIngredientsFromInvoices,
  type SeedResult,
} from "@/lib/canonical-ingredients"
import { batchCanonicalCosts } from "@/lib/canonical-cost-batch"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import type {
  CanonicalIngredientSummary,
  IngredientTrend,
} from "@/types/recipe"
import type {
  IngredientPriceHistory,
  IngredientPricePoint,
} from "@/types/invoice"

async function requireOwnerId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.id ?? null
}

async function requireScope(): Promise<{ ownerId: string; accountId: string } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  return { ownerId: session.user.id, accountId: session.user.accountId }
}

export async function listCanonicalIngredients(): Promise<
  CanonicalIngredientSummary[]
> {
  const scope = await requireScope()
  if (!scope) return []
  const { accountId } = scope

  const canonicals = await prisma.canonicalIngredient.findMany({
    where: { accountId },
    orderBy: { name: "asc" },
    include: {
      aliases: { select: { id: true } },
    },
  })

  const [costs, trendsByCanonical] = await Promise.all([
    batchCanonicalCosts(accountId),
    computeTrendsByCanonical(accountId),
  ])

  return canonicals.map((c) => {
    const cost = costs.get(c.id)
    return {
      id: c.id,
      name: c.name,
      defaultUnit: c.defaultUnit,
      category: c.category,
      aliasCount: c.aliases.length,
      recipeUnit: c.recipeUnit,
      costPerRecipeUnit: c.costPerRecipeUnit,
      costSource: (c.costSource as "manual" | "invoice" | null) ?? null,
      costLocked: c.costLocked,
      costUpdatedAt: c.costUpdatedAt,
      latestUnitCost: cost?.unitCost ?? null,
      latestUnit: cost?.unit ?? null,
      latestPriceAt: cost?.asOfDate ?? null,
      latestVendor: cost?.sourceVendor ? normalizeVendorName(cost.sourceVendor) : null,
      latestSku: cost?.sourceSku ?? null,
      trend30d: trendsByCanonical.get(c.id) ?? null,
    }
  })
}

/**
 * One batched pass over the last 90 days of matched invoice line items to
 * compute a ~30-day price trend per canonical ingredient. Safe unit comparison:
 * we only compare within the same (vendor, unit) — switching units or vendors
 * is not treated as a price change. If multiple (vendor, unit) pairs have
 * trends, the one with the largest |pctChange| wins.
 */
async function computeTrendsByCanonical(
  accountId: string
): Promise<Map<string, IngredientTrend>> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 90)

  const lines = await prisma.invoiceLineItem.findMany({
    where: {
      canonicalIngredientId: { not: null },
      invoice: {
        accountId,
        invoiceDate: { gte: cutoff, not: null },
      },
      unitPrice: { gt: 0 },
    },
    select: {
      canonicalIngredientId: true,
      unitPrice: true,
      unit: true,
      invoice: {
        select: {
          vendorName: true,
          invoiceDate: true,
        },
      },
    },
  })

  type Pt = { date: Date; price: number; vendor: string; unit: string | null }
  const buckets = new Map<string, Pt[]>() // key = canonicalId|vendor|unit
  const canonicalMap = new Map<string, string>() // bucketKey → canonicalId
  for (const li of lines) {
    if (!li.canonicalIngredientId || !li.invoice.invoiceDate) continue
    const vendor = normalizeVendorName(li.invoice.vendorName)
    const unit = li.unit?.trim().toUpperCase() || null
    const key = `${li.canonicalIngredientId}|${vendor}|${unit ?? "∅"}`
    canonicalMap.set(key, li.canonicalIngredientId)
    const arr = buckets.get(key) ?? []
    arr.push({
      date: li.invoice.invoiceDate,
      price: li.unitPrice,
      vendor,
      unit,
    })
    buckets.set(key, arr)
  }

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
  const cutoffMs = Date.now() - THIRTY_DAYS_MS

  const best = new Map<string, IngredientTrend>() // canonicalId → best trend
  for (const [key, pts] of buckets) {
    if (pts.length < 2) continue
    pts.sort((a, b) => b.date.getTime() - a.date.getTime()) // newest first
    const latest = pts[0]
    // Baseline: most recent point dated on or before (now - 30d). If none,
    // skip — we don't want to call a two-day swing a "30-day trend".
    const baseline = pts.find((p) => p.date.getTime() <= cutoffMs)
    if (!baseline) continue
    if (baseline.price <= 0) continue
    const pctChange = ((latest.price - baseline.price) / baseline.price) * 100
    if (!Number.isFinite(pctChange)) continue

    const canonicalId = canonicalMap.get(key)
    if (!canonicalId) continue
    const trend: IngredientTrend = {
      pctChange,
      latestPrice: latest.price,
      baselinePrice: baseline.price,
      vendor: latest.vendor,
      unit: latest.unit,
      latestDate: latest.date.toISOString().slice(0, 10),
      baselineDate: baseline.date.toISOString().slice(0, 10),
    }
    const prior = best.get(canonicalId)
    if (!prior || Math.abs(trend.pctChange) > Math.abs(prior.pctChange)) {
      best.set(canonicalId, trend)
    }
  }

  return best
}

/**
 * Full price history for one canonical ingredient, sourced from its matched
 * invoice line items. Oldest → newest. Scoped to the last `periodDays` days
 * (default 180). Consumers (charts, tables) are responsible for any grouping.
 */
export async function getIngredientPriceHistory(
  canonicalIngredientId: string,
  options?: { periodDays?: number }
): Promise<IngredientPriceHistory> {
  const scope = await requireScope()
  if (!scope) return { points: [] }
  const { accountId } = scope

  const canonical = await prisma.canonicalIngredient.findFirst({
    where: { id: canonicalIngredientId, accountId },
    select: { id: true },
  })
  if (!canonical) return { points: [] }

  const periodDays = options?.periodDays ?? 180
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - periodDays)

  const lines = await prisma.invoiceLineItem.findMany({
    where: {
      canonicalIngredientId,
      unitPrice: { gt: 0 },
      quantity: { gt: 0 },
      invoice: {
        accountId,
        invoiceDate: { gte: cutoff, not: null },
      },
    },
    select: {
      id: true,
      sku: true,
      unit: true,
      unitPrice: true,
      quantity: true,
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          vendorName: true,
        },
      },
    },
    orderBy: { invoice: { invoiceDate: "asc" } },
  })

  const points: IngredientPricePoint[] = []
  for (const li of lines) {
    if (!li.invoice.invoiceDate) continue
    points.push({
      date: li.invoice.invoiceDate.toISOString().slice(0, 10),
      unitPrice: li.unitPrice,
      quantity: li.quantity,
      unit: li.unit,
      vendor: normalizeVendorName(li.invoice.vendorName),
      sku: li.sku,
      invoiceId: li.invoice.id,
      invoiceNumber: li.invoice.invoiceNumber,
    })
  }

  return { points }
}

export async function createCanonicalIngredient(input: {
  name: string
  defaultUnit: string
  category?: string | null
  notes?: string | null
}) {
  const scope = await requireScope()
  if (!scope) throw new Error("Not authenticated")

  const created = await prisma.canonicalIngredient.create({
    data: {
      ownerId: scope.ownerId,
      accountId: scope.accountId,
      name: input.name.trim(),
      defaultUnit: input.defaultUnit,
      category: input.category ?? null,
      notes: input.notes ?? null,
    },
  })
  revalidatePath("/dashboard/ingredients")
  revalidatePath("/dashboard/recipes")
  return created
}

/**
 * Update the "recipe unit + cost per unit" fields on a canonical. Setting any
 * of these flags the canonical as manually edited (`costSource = "manual"`,
 * `costUpdatedAt = now`). Also lets the user toggle `costLocked` to block
 * future invoice-derived overrides.
 *
 * Pass `null` to clear a field.
 */
export async function updateCanonicalCost(input: {
  canonicalIngredientId: string
  recipeUnit?: string | null
  costPerRecipeUnit?: number | null
  costLocked?: boolean
}): Promise<void> {
  const scope = await requireScope()
  if (!scope) throw new Error("Not authenticated")
  const { accountId } = scope

  const existing = await prisma.canonicalIngredient.findFirst({
    where: { id: input.canonicalIngredientId, accountId },
    select: { id: true },
  })
  if (!existing) throw new Error("Canonical ingredient not found")

  const data: {
    recipeUnit?: string | null
    costPerRecipeUnit?: number | null
    costSource?: "manual"
    costLocked?: boolean
    costUpdatedAt?: Date
  } = {}

  const touchedCost =
    input.recipeUnit !== undefined || input.costPerRecipeUnit !== undefined
  if (input.recipeUnit !== undefined) data.recipeUnit = input.recipeUnit
  if (input.costPerRecipeUnit !== undefined) {
    data.costPerRecipeUnit = input.costPerRecipeUnit
  }
  if (touchedCost) {
    data.costSource = "manual"
    data.costUpdatedAt = new Date()
  }
  if (input.costLocked !== undefined) data.costLocked = input.costLocked

  if (Object.keys(data).length === 0) return

  await prisma.canonicalIngredient.update({
    where: { id: input.canonicalIngredientId },
    data,
  })

  revalidatePath("/dashboard/ingredients")
  revalidatePath("/dashboard/recipes")
  revalidatePath("/dashboard/menu/catalog")
}

export async function runCanonicalIngredientSeed(): Promise<SeedResult> {
  const scope = await requireScope()
  if (!scope) throw new Error("Not authenticated")
  const result = await seedCanonicalIngredientsFromInvoices(scope.ownerId, scope.accountId)
  if (result.canonicalsCreated > 0 || result.aliasesCreated > 0) {
    revalidatePath("/dashboard/ingredients")
    revalidatePath("/dashboard/recipes")
    revalidatePath("/dashboard/menu/catalog")
  }
  return result
}

/**
 * Merge `sourceId` into `targetId`. Re-parents every table that FK's onto
 * CanonicalIngredient, then deletes the source. Target wins on unique-key
 * collisions (SKU match rules, per-store aliases). RecipeIngredient must be
 * re-parented before delete because its FK is `onDelete: Restrict`.
 */
export async function mergeCanonicalIngredients(input: {
  sourceId: string
  targetId: string
}): Promise<{
  lineItems: number
  aliases: number
  skuMatches: number
  recipeUses: number
}> {
  const scope = await requireScope()
  if (!scope) throw new Error("Not authenticated")
  const { accountId } = scope

  if (input.sourceId === input.targetId) {
    throw new Error("Cannot merge an ingredient into itself")
  }

  const [source, target] = await Promise.all([
    prisma.canonicalIngredient.findUnique({ where: { id: input.sourceId } }),
    prisma.canonicalIngredient.findUnique({ where: { id: input.targetId } }),
  ])
  if (!source || !target) throw new Error("Ingredient not found")
  if (source.accountId !== accountId || target.accountId !== accountId) {
    throw new Error("Not authorized")
  }

  const result = await prisma.$transaction(async (tx) => {
    const recipeUses = await tx.recipeIngredient.updateMany({
      where: { canonicalIngredientId: input.sourceId },
      data: { canonicalIngredientId: input.targetId },
    })

    const lineItems = await tx.invoiceLineItem.updateMany({
      where: { canonicalIngredientId: input.sourceId },
      data: { canonicalIngredientId: input.targetId },
    })

    const targetSkuKeys = new Set(
      (
        await tx.ingredientSkuMatch.findMany({
          where: { canonicalIngredientId: input.targetId },
          select: { vendorName: true, sku: true },
        })
      ).map((m) => `${m.vendorName}::${m.sku}`)
    )
    const sourceSkuRows = await tx.ingredientSkuMatch.findMany({
      where: { canonicalIngredientId: input.sourceId },
      select: { id: true, vendorName: true, sku: true },
    })
    const collidingSkuIds = sourceSkuRows
      .filter((m) => targetSkuKeys.has(`${m.vendorName}::${m.sku}`))
      .map((m) => m.id)
    if (collidingSkuIds.length > 0) {
      await tx.ingredientSkuMatch.deleteMany({
        where: { id: { in: collidingSkuIds } },
      })
    }
    const skuMatches = await tx.ingredientSkuMatch.updateMany({
      where: { canonicalIngredientId: input.sourceId },
      data: { canonicalIngredientId: input.targetId },
    })

    const targetAliasKeys = new Set(
      (
        await tx.ingredientAlias.findMany({
          where: { canonicalIngredientId: input.targetId },
          select: { storeId: true, rawName: true },
        })
      ).map((a) => `${a.storeId}::${a.rawName}`)
    )
    const sourceAliasRows = await tx.ingredientAlias.findMany({
      where: { canonicalIngredientId: input.sourceId },
      select: { id: true, storeId: true, rawName: true },
    })
    const collidingAliasIds = sourceAliasRows
      .filter((a) => targetAliasKeys.has(`${a.storeId}::${a.rawName}`))
      .map((a) => a.id)
    if (collidingAliasIds.length > 0) {
      await tx.ingredientAlias.deleteMany({
        where: { id: { in: collidingAliasIds } },
      })
    }
    const aliases = await tx.ingredientAlias.updateMany({
      where: { canonicalIngredientId: input.sourceId },
      data: { canonicalIngredientId: input.targetId },
    })

    await tx.canonicalIngredient.delete({ where: { id: input.sourceId } })

    return {
      lineItems: lineItems.count,
      aliases: aliases.count,
      skuMatches: skuMatches.count,
      recipeUses: recipeUses.count,
    }
  })

  revalidatePath("/dashboard/ingredients")
  revalidatePath("/dashboard/recipes")
  revalidatePath("/dashboard/menu/catalog")
  return result
}
