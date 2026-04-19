"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  seedCanonicalIngredientsFromInvoices,
  getCanonicalIngredientCost,
  type SeedResult,
} from "@/lib/canonical-ingredients"
import { invalidateDailyCogs } from "@/lib/cogs-invalidate"
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
