// assertNoCycles must accept an optional Prisma client so upsertRecipe can
// run it INSIDE its transaction (reading uncommitted ingredient writes).
// Without the param it reads through the global client and cannot see the
// rows the transaction just wrote.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { recipeIngredient: { findMany: vi.fn() } },
}))

import { prisma } from "@/lib/prisma"
import { assertNoCycles, RecipeCycleError } from "@/lib/recipe-cost"

type Edge = { componentRecipeId: string | null }

function clientWithEdges(edges: Record<string, string[]>) {
  return {
    recipeIngredient: {
      findMany: vi.fn(async (args: { where: { recipeId: string } }): Promise<Edge[]> =>
        (edges[args.where.recipeId] ?? []).map((id) => ({ componentRecipeId: id })),
      ),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.recipeIngredient.findMany).mockResolvedValue([] as never)
})

describe("assertNoCycles", () => {
  it("walks the provided client (not the global prisma) and detects a cycle", async () => {
    const db = clientWithEdges({ r1: ["r2"], r2: ["r1"] })

    await expect(assertNoCycles("r1", db as never)).rejects.toThrow(RecipeCycleError)
    expect(db.recipeIngredient.findMany).toHaveBeenCalled()
    expect(prisma.recipeIngredient.findMany).not.toHaveBeenCalled()
  })

  it("resolves for an acyclic graph on the provided client", async () => {
    const db = clientWithEdges({ r1: ["r2"], r2: [] })
    await expect(assertNoCycles("r1", db as never)).resolves.toBeUndefined()
  })

  it("defaults to the global prisma client when no client is given", async () => {
    vi.mocked(prisma.recipeIngredient.findMany).mockImplementation((async (args: {
      where: { recipeId: string }
    }) => {
      const edges: Record<string, string[]> = { r1: ["r2"], r2: ["r1"] }
      return (edges[args.where.recipeId] ?? []).map((id) => ({ componentRecipeId: id }))
    }) as never)

    await expect(assertNoCycles("r1")).rejects.toThrow(RecipeCycleError)
  })
})
