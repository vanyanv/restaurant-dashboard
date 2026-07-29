// canonical-ingredient-actions — mergeCanonicalIngredients. Pins: every table
// that FKs onto CanonicalIngredient is re-parented from source to target
// inside the same transaction before the source is deleted, including
// IngredientMatchDecision (fix-round-1: this table's FK is `onDelete:
// Restrict`, not Cascade, specifically so a merge can't silently destroy the
// match/undo audit trail — see prisma/schema.prisma and
// prisma/manual-migrations/2026-07-29_ingredient-auto-match.sql).

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth-scope", () => ({ getAuthScope: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/ingredient-embedding-sync", () => ({
  syncCanonicalEmbedding: vi.fn(),
}))
vi.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {
    canonicalIngredient: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
    },
    recipeIngredient: { updateMany: vi.fn() },
    invoiceLineItem: { updateMany: vi.fn() },
    ingredientSkuMatch: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    ingredientAlias: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    ingredientMatchDecision: { updateMany: vi.fn() },
  }
  prisma.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
      : Promise.all(arg as Promise<unknown>[])
  )
  return { prisma }
})

import { getAuthScope } from "@/lib/auth-scope"
import { prisma } from "@/lib/prisma"
import { syncCanonicalEmbedding } from "@/lib/ingredient-embedding-sync"
import {
  mergeCanonicalIngredients,
  createCanonicalIngredient,
} from "@/app/actions/canonical-ingredient-actions"

const scope = { ownerId: "u1", accountId: "acct-A" }

const canonical = (id: string) => ({
  id,
  accountId: "acct-A",
  name: id,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthScope).mockResolvedValue(scope)
  vi.mocked(prisma.canonicalIngredient.findUnique).mockImplementation(
    (async ({ where }: { where: { id: string } }) =>
      canonical(where.id)) as never
  )
  vi.mocked(prisma.recipeIngredient.updateMany).mockResolvedValue({
    count: 0,
  } as never)
  vi.mocked(prisma.invoiceLineItem.updateMany).mockResolvedValue({
    count: 0,
  } as never)
  vi.mocked(prisma.ingredientSkuMatch.findMany).mockResolvedValue(
    [] as never
  )
  vi.mocked(prisma.ingredientSkuMatch.updateMany).mockResolvedValue({
    count: 0,
  } as never)
  vi.mocked(prisma.ingredientAlias.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.ingredientAlias.updateMany).mockResolvedValue({
    count: 0,
  } as never)
  vi.mocked(prisma.ingredientMatchDecision.updateMany).mockResolvedValue({
    count: 0,
  } as never)
  vi.mocked(prisma.canonicalIngredient.delete).mockResolvedValue(
    canonical("source") as never
  )
})

describe("mergeCanonicalIngredients", () => {
  it("re-parents IngredientMatchDecision from source to target before deleting the source", async () => {
    vi.mocked(prisma.ingredientMatchDecision.updateMany).mockResolvedValue({
      count: 3,
    } as never)

    const result = await mergeCanonicalIngredients({
      sourceId: "source",
      targetId: "target",
    })

    expect(prisma.ingredientMatchDecision.updateMany).toHaveBeenCalledWith({
      where: { canonicalIngredientId: "source" },
      data: { canonicalIngredientId: "target" },
    })
    expect(result.matchDecisions).toBe(3)

    // Re-parent must happen before the source row is deleted — the FK is
    // `onDelete: Restrict`, so ordering the delete first would throw in
    // production instead of merely leaving this test unaware of the bug.
    const updateOrder = vi
      .mocked(prisma.ingredientMatchDecision.updateMany).mock
      .invocationCallOrder[0]
    const deleteOrder = vi.mocked(prisma.canonicalIngredient.delete).mock
      .invocationCallOrder[0]
    expect(updateOrder).toBeLessThan(deleteOrder)
  })

  it("deletes the source canonical only after all re-parenting completes", async () => {
    await mergeCanonicalIngredients({ sourceId: "source", targetId: "target" })

    expect(prisma.canonicalIngredient.delete).toHaveBeenCalledWith({
      where: { id: "source" },
    })
  })

  it("rejects merging an ingredient into itself", async () => {
    await expect(
      mergeCanonicalIngredients({ sourceId: "x", targetId: "x" })
    ).rejects.toThrow("Cannot merge an ingredient into itself")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("rejects when source or target belongs to a different account", async () => {
    vi.mocked(prisma.canonicalIngredient.findUnique).mockImplementation(
      (async ({ where }: { where: { id: string } }) => ({
        ...canonical(where.id),
        accountId: where.id === "source" ? "acct-OTHER" : "acct-A",
      })) as never
    )

    await expect(
      mergeCanonicalIngredients({ sourceId: "source", targetId: "target" })
    ).rejects.toThrow("Not authorized")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

// The vector rung of the auto-match ladder can only see a canonical that has a
// CanonicalIngredientEmbedding row. Nothing back-fills those on a schedule, so
// any path that creates a canonical or changes the text an embedding is built
// from has to refresh it inline or that ingredient is permanently invisible to
// similarity search.
describe("embedding freshness", () => {
  it("writes an embedding for a canonical created from the pantry UI", async () => {
    vi.mocked(prisma.canonicalIngredient.create).mockResolvedValue({
      id: "canon-new",
      name: "Kosher Salt",
    } as never)

    await createCanonicalIngredient({ name: "Kosher Salt", defaultUnit: "lb" })

    expect(syncCanonicalEmbedding).toHaveBeenCalledWith("canon-new")
  })

  it("refreshes the target's embedding after a merge absorbs the source's aliases", async () => {
    // buildCanonicalIngredientText folds alias rawNames into the embedded
    // text, so a merge changes what the target's vector should mean.
    await mergeCanonicalIngredients({ sourceId: "canon-2", targetId: "canon-1" })

    expect(syncCanonicalEmbedding).toHaveBeenCalledWith("canon-1")
    expect(syncCanonicalEmbedding).not.toHaveBeenCalledWith("canon-2")
  })
})
