"use server"

import { getServerSession } from "next-auth"
import { revalidatePath } from "next/cache"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  seedCanonicalIngredientsFromInvoices,
  getCanonicalIngredientCost,
  type SeedResult,
} from "@/lib/canonical-ingredients"
import { invalidateDailyCogs } from "@/lib/cogs-invalidate"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import type { CanonicalIngredientSummary } from "@/types/recipe"

async function requireOwnerId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.id ?? null
}

export async function listCanonicalIngredients(): Promise<
  CanonicalIngredientSummary[]
> {
  const ownerId = await requireOwnerId()
  if (!ownerId) return []

  const canonicals = await prisma.canonicalIngredient.findMany({
    where: { ownerId },
    orderBy: { name: "asc" },
    include: {
      aliases: { select: { id: true } },
    },
  })

  const costs = await Promise.all(
    canonicals.map((c) => getCanonicalIngredientCost(c.id))
  )

  return canonicals.map((c, i) => {
    const cost = costs[i]
    return {
      id: c.id,
      name: c.name,
      defaultUnit: c.defaultUnit,
      category: c.category,
      aliasCount: c.aliases.length,
      latestUnitCost: cost?.unitCost ?? null,
      latestUnit: cost?.unit ?? null,
      latestPriceAt: cost?.asOfDate ?? null,
      latestVendor: cost ? normalizeVendorName(cost.sourceVendor) : null,
      latestSku: cost?.sourceSku ?? null,
    }
  })
}

export async function createCanonicalIngredient(input: {
  name: string
  defaultUnit: string
  category?: string | null
  notes?: string | null
}) {
  const ownerId = await requireOwnerId()
  if (!ownerId) throw new Error("Not authenticated")

  const created = await prisma.canonicalIngredient.create({
    data: {
      ownerId,
      name: input.name.trim(),
      defaultUnit: input.defaultUnit,
      category: input.category ?? null,
      notes: input.notes ?? null,
    },
  })
  await invalidateDailyCogs({ kind: "owner-full", ownerId })
  return created
}

export async function runCanonicalIngredientSeed(): Promise<SeedResult> {
  const ownerId = await requireOwnerId()
  if (!ownerId) throw new Error("Not authenticated")
  const result = await seedCanonicalIngredientsFromInvoices(ownerId)
  if (result.canonicalsCreated > 0 || result.aliasesCreated > 0) {
    await invalidateDailyCogs({ kind: "owner-full", ownerId })
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
  const ownerId = await requireOwnerId()
  if (!ownerId) throw new Error("Not authenticated")

  if (input.sourceId === input.targetId) {
    throw new Error("Cannot merge an ingredient into itself")
  }

  const [source, target] = await Promise.all([
    prisma.canonicalIngredient.findUnique({ where: { id: input.sourceId } }),
    prisma.canonicalIngredient.findUnique({ where: { id: input.targetId } }),
  ])
  if (!source || !target) throw new Error("Ingredient not found")
  if (source.ownerId !== ownerId || target.ownerId !== ownerId) {
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

  await invalidateDailyCogs({ kind: "owner-full", ownerId })
  revalidatePath("/dashboard/ingredients")
  return result
}
