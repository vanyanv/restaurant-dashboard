// menu-item mapping actions — the human-confirm write path for POS item →
// recipe mappings. Pins auth/account scoping, the per-store upsert fan-out,
// batch validation filtering.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth-scope", () => ({ getAuthScope: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/otter-subitem-aggregation", () => ({ attachSubItemMappings: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn() },
    recipe: { findFirst: vi.fn(), findMany: vi.fn() },
    otterItemMapping: { findMany: vi.fn(), upsert: vi.fn() },
    otterMenuItem: { groupBy: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}))

import { getAuthScope } from "@/lib/auth-scope"
import { prisma } from "@/lib/prisma"
import {
  mapOtterItemToRecipe,
  mapOtterItemsBatch,
} from "@/app/actions/menu-item-actions"

const scope = { ownerId: "u1", accountId: "acct-A", role: "OWNER" }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthScope).mockResolvedValue(scope as never)
  vi.mocked(prisma.store.findMany).mockResolvedValue([
    { id: "s1", isActive: true },
    { id: "s2", isActive: true },
  ] as never)
  // upsert returns the args so tests can inspect what the transaction ran
  vi.mocked(prisma.otterItemMapping.upsert).mockImplementation(((args: unknown) =>
    Promise.resolve(args)) as never)
})

describe("mapOtterItemToRecipe", () => {
  it("throws when not authenticated", async () => {
    vi.mocked(getAuthScope).mockResolvedValue(null as never)
    await expect(
      mapOtterItemToRecipe({ otterItemName: "Burger", recipeId: "r1" })
    ).rejects.toThrow("Not authenticated")
    expect(prisma.otterItemMapping.upsert).not.toHaveBeenCalled()
  })

  it("rejects a recipe outside the caller's account", async () => {
    vi.mocked(prisma.recipe.findFirst).mockResolvedValue(null as never)
    await expect(
      mapOtterItemToRecipe({ otterItemName: "Burger", recipeId: "r-other" })
    ).rejects.toThrow("Recipe not found")
    const where = vi.mocked(prisma.recipe.findFirst).mock.calls[0][0]?.where
    expect(where).toMatchObject({ id: "r-other", accountId: "acct-A" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("upserts one mapping per store keyed on (storeId, otterItemName)", async () => {
    vi.mocked(prisma.recipe.findFirst).mockResolvedValue({ id: "r1" } as never)

    await mapOtterItemToRecipe({ otterItemName: "Burger", recipeId: "r1" })

    const upsertCalls = vi.mocked(prisma.otterItemMapping.upsert).mock.calls
    expect(upsertCalls).toHaveLength(2)
    expect(
      upsertCalls.map((c) => c[0]!.where.storeId_otterItemName!.storeId)
    ).toEqual(["s1", "s2"])
    expect(upsertCalls[0][0]).toMatchObject({
      create: { storeId: "s1", otterItemName: "Burger", recipeId: "r1" },
      update: { recipeId: "r1" },
    })
    expect(upsertCalls[0][0].update.confirmedAt).toBeInstanceOf(Date)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })
})

describe("mapOtterItemsBatch", () => {
  it("returns {mapped: 0} without a transaction for empty pairs", async () => {
    expect(await mapOtterItemsBatch([])).toEqual({ mapped: 0 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("filters out pairs whose recipe is not in the account and maps the rest", async () => {
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([{ id: "r-good" }] as never)

    const result = await mapOtterItemsBatch([
      { otterItemName: "Burger", recipeId: "r-good" },
      { otterItemName: "Hijack", recipeId: "r-foreign" },
    ])

    expect(result).toEqual({ mapped: 1 })
    // 1 valid pair × 2 stores
    const upsertCalls = vi.mocked(prisma.otterItemMapping.upsert).mock.calls
    expect(upsertCalls).toHaveLength(2)
    for (const call of upsertCalls) {
      expect(call[0].create.otterItemName).toBe("Burger")
      expect(call[0].create.recipeId).toBe("r-good")
    }
  })

  it("returns {mapped: 0} when no pair survives validation", async () => {
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([] as never)
    const result = await mapOtterItemsBatch([
      { otterItemName: "Burger", recipeId: "r-foreign" },
    ])
    expect(result).toEqual({ mapped: 0 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
