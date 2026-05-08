// Contract tests for the count-entry data actions. These wrap the slice-1
// stock-count actions with a tighter API for the count entry UI: one call to
// resolve-or-create the in-progress count, one call to fetch the canonical
// ingredient list (with any already-saved lines) keyed by category zone.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn() },
    stockCount: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    stockCountLine: { findMany: vi.fn() },
    canonicalIngredient: { findMany: vi.fn() },
    ingredientSkuMatch: { findMany: vi.fn() },
    ingredientModelState: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/inventory/running-on-hand", () => ({
  computeRunningOnHand: vi.fn(),
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { computeRunningOnHand } from "@/lib/inventory/running-on-hand"
import {
  startOrResumeStockCount,
  getCountEntryData,
} from "@/app/actions/inventory/count-entry-actions"

const session = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
  // Default: no estimate signal. Tests that care override per-call.
  vi.mocked(computeRunningOnHand).mockResolvedValue(null)
  vi.mocked(prisma.ingredientModelState.findMany).mockResolvedValue([] as never)
})

describe("startOrResumeStockCount", () => {
  it("returns null when no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const result = await startOrResumeStockCount({ storeId: "s1" })
    expect(result).toBeNull()
  })

  it("rejects a store that isn't in the caller's account", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([{ id: "s2" }] as never)
    const result = await startOrResumeStockCount({ storeId: "s1" })
    expect(result).toEqual({ ok: false, error: "store_not_in_account" })
    expect(prisma.stockCount.create).not.toHaveBeenCalled()
  })

  it("returns the existing in-progress count when one exists", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([{ id: "s1" }] as never)
    vi.mocked(prisma.stockCount.findFirst).mockResolvedValue({ id: "c-existing" } as never)

    const result = await startOrResumeStockCount({ storeId: "s1" })

    expect(result).toEqual({ ok: true, stockCountId: "c-existing", resumed: true })
    expect(prisma.stockCount.create).not.toHaveBeenCalled()
  })

  it("creates a new IN_PROGRESS count when none exists", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([{ id: "s1" }] as never)
    vi.mocked(prisma.stockCount.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.stockCount.create).mockResolvedValue({ id: "c-new" } as never)

    const result = await startOrResumeStockCount({ storeId: "s1" })

    expect(result).toEqual({ ok: true, stockCountId: "c-new", resumed: false })
    expect(prisma.stockCount.create).toHaveBeenCalledOnce()
    const callArg = vi.mocked(prisma.stockCount.create).mock.calls[0][0] as {
      data: { storeId: string; countedByUserId: string; status: string }
    }
    expect(callArg.data.storeId).toBe("s1")
    expect(callArg.data.countedByUserId).toBe("u1")
    expect(callArg.data.status).toBe("IN_PROGRESS")
  })
})

describe("getCountEntryData", () => {
  it("returns null when no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const result = await getCountEntryData({ stockCountId: "c1" })
    expect(result).toBeNull()
  })

  it("returns count_not_found when the count doesn't exist", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.stockCount.findUnique).mockResolvedValue(null)
    const result = await getCountEntryData({ stockCountId: "c1" })
    expect(result).toEqual({ ok: false, error: "count_not_found" })
  })

  it("rejects a count belonging to another account", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.stockCount.findUnique).mockResolvedValue({
      id: "c1",
      storeId: "s9",
      status: "IN_PROGRESS",
      countedAt: new Date("2026-05-07"),
      store: { accountId: "acct-OTHER", name: "X" },
    } as never)
    const result = await getCountEntryData({ stockCountId: "c1" })
    expect(result).toEqual({ ok: false, error: "count_not_in_account" })
  })

  it("returns ingredients grouped by category and merges in any existing saved lines", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.stockCount.findUnique).mockResolvedValue({
      id: "c1",
      storeId: "s1",
      status: "IN_PROGRESS",
      countedAt: new Date("2026-05-07"),
      store: { accountId: "acct-A", name: "Lakewood" },
    } as never)
    vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([
      { id: "ing-1", name: "Mozzarella", category: "Dairy", recipeUnit: "lb" },
      { id: "ing-2", name: "Romaine", category: "Produce", recipeUnit: "head" },
      { id: "ing-3", name: "Buns", category: null, recipeUnit: "each" },
    ] as never)
    vi.mocked(prisma.stockCountLine.findMany).mockResolvedValue([
      {
        canonicalIngredientId: "ing-1",
        nativeQty: 8,
        nativeUnit: "lb",
        qtyInRecipeUnit: 8,
        note: null,
      },
    ] as never)

    const result = await getCountEntryData({ stockCountId: "c1" })

    expect(result?.ok).toBe(true)
    if (!result?.ok) return
    expect(result.count.id).toBe("c1")
    expect(result.count.storeId).toBe("s1")
    expect(result.count.storeName).toBe("Lakewood")
    expect(result.count.status).toBe("IN_PROGRESS")
    expect(result.ingredients).toHaveLength(3)

    const moz = result.ingredients.find((i) => i.id === "ing-1")
    expect(moz?.existingLine).toEqual({
      nativeQty: 8,
      nativeUnit: "lb",
      qtyInRecipeUnit: 8,
      note: null,
    })

    const romaine = result.ingredients.find((i) => i.id === "ing-2")
    expect(romaine?.existingLine).toBeNull()

    const buns = result.ingredients.find((i) => i.id === "ing-3")
    expect(buns?.category).toBe("Uncategorized")

    // estimatedOnHand defaults to null when the running-on-hand helper had nothing to anchor on.
    expect(moz?.estimatedOnHand).toBeNull()
  })

  it("freezes the model's estimated on-hand on each ingredient at the count's countedAt", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.stockCount.findUnique).mockResolvedValue({
      id: "c1",
      storeId: "s1",
      status: "IN_PROGRESS",
      countedAt: new Date("2026-05-07"),
      store: { accountId: "acct-A", name: "Lakewood" },
    } as never)
    vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([
      { id: "ing-1", name: "Mozzarella", category: "Dairy", recipeUnit: "lb" },
      { id: "ing-2", name: "Romaine", category: "Produce", recipeUnit: "head" },
    ] as never)
    vi.mocked(prisma.stockCountLine.findMany).mockResolvedValue([] as never)
    vi.mocked(computeRunningOnHand).mockImplementation(async ({ ingredientId }) => {
      if (ingredientId === "ing-1") {
        return {
          asOf: new Date("2026-05-07"),
          storeId: "s1",
          ingredientId,
          ingredientName: "Mozzarella",
          recipeUnit: "lb",
          baseQty: 0,
          baseAt: null,
          deliveriesQty: 12,
          depletionQty: 4,
          adjustmentsQty: 0,
          onHand: 8,
          partial: false,
        }
      }
      return null
    })

    const result = await getCountEntryData({ stockCountId: "c1" })
    if (!result?.ok) throw new Error("expected ok")

    const moz = result.ingredients.find((i) => i.id === "ing-1")
    expect(moz?.estimatedOnHand).toBe(8)

    const romaine = result.ingredients.find((i) => i.id === "ing-2")
    expect(romaine?.estimatedOnHand).toBeNull()

    // Estimate is frozen at the count's countedAt, not "now" — so two opens
    // of the same count produce identical training labels.
    const callForMoz = vi
      .mocked(computeRunningOnHand)
      .mock.calls.find((c) => c[0].ingredientId === "ing-1")
    expect(callForMoz?.[0].asOf).toEqual(new Date("2026-05-07"))
  })

  it("scopes ingredient list to the caller's account", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.stockCount.findUnique).mockResolvedValue({
      id: "c1",
      storeId: "s1",
      status: "IN_PROGRESS",
      countedAt: new Date("2026-05-07"),
      store: { accountId: "acct-A", name: "Lakewood" },
    } as never)
    vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.stockCountLine.findMany).mockResolvedValue([] as never)

    await getCountEntryData({ stockCountId: "c1" })

    const callArg = vi.mocked(prisma.canonicalIngredient.findMany).mock.calls[0][0] as {
      where: { accountId: string }
    }
    expect(callArg.where.accountId).toBe("acct-A")
  })
})
