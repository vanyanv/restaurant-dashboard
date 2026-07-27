"use server"

// AI mapping/combo proposals: propose + one-click confirm.
//
// Generation lives in src/lib/mapping-proposals-core.ts (session-free, so
// the post-sync cron can run it); this file resolves the session and owns
// the human decision surface: list, accept (the Accept click IS the
// confirmation — isConfirmed: true on created recipes), reject. Historical
// UNMAPPED DailyCogsItem rows heal on the next cogs-sweep cron; the UI copy
// says "history updates overnight".

import { getAuthScope } from "@/lib/auth-scope"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { assertNoCycles } from "@/lib/recipe-cost"
import {
  generateMappingProposalsCore,
  type GenerateProposalsResult,
  type ProposalPayload,
} from "@/lib/mapping-proposals-core"

export type {
  ProposalComponent,
  ProposalPayload,
  GenerateProposalsResult,
} from "@/lib/mapping-proposals-core"

export type MappingProposalView = {
  id: string
  otterItemName: string
  category: string
  kind: string
  confidence: number | null
  model: string | null
  payload: ProposalPayload
  proposedRecipeId: string | null
  proposedRecipeName: string | null
  createdAt: Date
}

export async function generateMappingProposals(input: {
  storeId?: string
  maxItems?: number
}): Promise<GenerateProposalsResult> {
  const scope = await getAuthScope()
  if (!scope) return { ok: false, error: "not_authenticated" }
  return generateMappingProposalsCore(scope, input)
}

export async function listMappingProposals(): Promise<MappingProposalView[]> {
  const scope = await getAuthScope()
  if (!scope) return []

  const rows = await prisma.recipeMappingProposal.findMany({
    where: { accountId: scope.accountId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: { proposedRecipe: { select: { itemName: true } } },
  })
  return rows.map((row) => ({
    id: row.id,
    otterItemName: row.otterItemName,
    category: row.category,
    kind: row.kind,
    confidence: row.confidence,
    model: row.model,
    payload: row.payload as ProposalPayload,
    proposedRecipeId: row.proposedRecipeId,
    proposedRecipeName: row.proposedRecipe?.itemName ?? null,
    createdAt: row.createdAt,
  }))
}

export type AcceptProposalResult =
  | { ok: true; recipeId: string }
  | { ok: false; error: "not_authenticated" | "not_found" | "not_pending" | "invalid_proposal" }

export async function acceptMappingProposal(
  proposalId: string
): Promise<AcceptProposalResult> {
  const scope = await getAuthScope()
  if (!scope) return { ok: false, error: "not_authenticated" }

  const proposal = await prisma.recipeMappingProposal.findFirst({
    where: { id: proposalId, accountId: scope.accountId },
  })
  if (!proposal) return { ok: false, error: "not_found" }
  if (proposal.status !== "PENDING") return { ok: false, error: "not_pending" }

  const stores = await prisma.store.findMany({
    where: { accountId: scope.accountId },
    select: { id: true },
  })
  const payload = proposal.payload as ProposalPayload
  const now = new Date()

  let recipeId: string
  if (proposal.kind === "MATCH") {
    if (!proposal.proposedRecipeId) return { ok: false, error: "invalid_proposal" }
    const recipe = await prisma.recipe.findFirst({
      where: { id: proposal.proposedRecipeId, accountId: scope.accountId },
      select: { id: true },
    })
    if (!recipe) return { ok: false, error: "invalid_proposal" }
    recipeId = recipe.id

    await prisma.$transaction(async (tx) => {
      for (const s of stores) {
        await tx.otterItemMapping.upsert({
          where: {
            storeId_otterItemName: {
              storeId: s.id,
              otterItemName: proposal.otterItemName,
            },
          },
          create: {
            storeId: s.id,
            otterItemName: proposal.otterItemName,
            recipeId,
          },
          update: { recipeId, confirmedAt: now },
        })
      }
      await tx.recipeMappingProposal.update({
        where: { id: proposal.id },
        data: {
          status: "ACCEPTED",
          resultRecipeId: recipeId,
          decidedAt: now,
          decidedById: scope.ownerId,
        },
      })
    })
  } else {
    const suggestedName = payload.suggestedName ?? proposal.otterItemName
    const suggestedCategory = payload.suggestedCategory ?? proposal.category
    const components = payload.components.filter(
      (c) => c.componentRecipeId || c.canonicalIngredientId
    )
    if (components.length === 0) return { ok: false, error: "invalid_proposal" }

    // Recipe names are unique per (accountId, itemName, category) — if one
    // already exists, map to it rather than failing on the constraint.
    const collision = await prisma.recipe.findFirst({
      where: {
        accountId: scope.accountId,
        itemName: suggestedName,
        category: suggestedCategory,
      },
      select: { id: true },
    })

    recipeId = await prisma.$transaction(async (tx) => {
      let id: string
      if (collision) {
        id = collision.id
      } else {
        const recipe = await tx.recipe.create({
          data: {
            ownerId: scope.ownerId,
            accountId: scope.accountId,
            itemName: suggestedName,
            category: suggestedCategory,
            isSellable: true,
            isAiGenerated: true,
            // The Accept click is the human confirmation.
            isConfirmed: true,
          },
          select: { id: true },
        })
        id = recipe.id
        await tx.recipeIngredient.createMany({
          data: components.map((c) => ({
            recipeId: id,
            componentRecipeId: c.componentRecipeId ?? null,
            canonicalIngredientId: c.canonicalIngredientId ?? null,
            ingredientName: c.name,
            quantity: c.quantity,
            unit: c.unit,
          })),
        })
        // A hallucinated self-reference (combo containing itself) must roll
        // the whole transaction back.
        await assertNoCycles(id, tx)
      }

      for (const s of stores) {
        await tx.otterItemMapping.upsert({
          where: {
            storeId_otterItemName: {
              storeId: s.id,
              otterItemName: proposal.otterItemName,
            },
          },
          create: {
            storeId: s.id,
            otterItemName: proposal.otterItemName,
            recipeId: id,
          },
          update: { recipeId: id, confirmedAt: now },
        })
      }
      await tx.recipeMappingProposal.update({
        where: { id: proposal.id },
        data: {
          status: "ACCEPTED",
          resultRecipeId: id,
          decidedAt: now,
          decidedById: scope.ownerId,
        },
      })
      return id
    })
  }

  revalidatePath("/dashboard/recipes")
  revalidatePath("/dashboard/menu/catalog")
  revalidatePath("/dashboard/menu-profit")
  return { ok: true, recipeId }
}

export async function rejectMappingProposal(
  proposalId: string
): Promise<{ ok: boolean }> {
  const scope = await getAuthScope()
  if (!scope) return { ok: false }

  const proposal = await prisma.recipeMappingProposal.findFirst({
    where: { id: proposalId, accountId: scope.accountId },
    select: { id: true, status: true },
  })
  if (!proposal || proposal.status !== "PENDING") return { ok: false }

  await prisma.recipeMappingProposal.update({
    where: { id: proposal.id },
    data: { status: "REJECTED", decidedAt: new Date(), decidedById: scope.ownerId },
  })
  revalidatePath("/dashboard/recipes")
  return { ok: true }
}
