// Contract tests for the stock-count server actions. Mocks Prisma + next-auth
// so we exercise the actions without a database. Asserts the auth + scoping
// preamble (matches resolveStoreScope), the IN_PROGRESS / COMPLETED state
// machine, and unit conversion via IngredientSkuMatch on saveStockCountLine.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn() },
    stockCount: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    stockCountLine: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    canonicalIngredient: { findUnique: vi.fn() },
    ingredientSkuMatch: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/inventory/calibration-update", () => ({
  applyCalibrationUpdatesForCount: vi.fn().mockResolvedValue(undefined),
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import {
  createStockCount,
  saveStockCountLine,
  completeStockCount,
  listStockCounts,
} from "@/app/actions/inventory/stock-count-actions"

const session = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("createStockCount", () => {
  it("returns null when no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const result = await createStockCount({ storeId: "s1", countedAt: new Date("2026-05-07") })
    expect(result).toBeNull()
  })

  it("returns error when storeId is not in the caller's account", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([{ id: "s2" }] as never)
    const result = await createStockCount({ storeId: "s1", countedAt: new Date("2026-05-07") })
    expect(result).toEqual({ ok: false, error: "store_not_in_account" })
    expect(prisma.stockCount.create).not.toHaveBeenCalled()
  })

  it("creates a count in IN_PROGRESS state with the session user as the counter", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([{ id: "s1" }] as never)
    vi.mocked(prisma.stockCount.create).mockResolvedValue({
      id: "c1",
      storeId: "s1",
      countedByUserId: "u1",
      status: "IN_PROGRESS",
      countedAt: new Date("2026-05-07"),
    } as never)

    const result = await createStockCount({ storeId: "s1", countedAt: new Date("2026-05-07"), note: "opening" })

    expect(result).toEqual({ ok: true, stockCountId: "c1" })
    expect(prisma.stockCount.create).toHaveBeenCalledWith({
      data: {
        storeId: "s1",
        countedByUserId: "u1",
        countedAt: new Date("2026-05-07"),
        status: "IN_PROGRESS",
        note: "opening",
      },
      select: { id: true },
    })
  })

  it("rejects createStockCount when there is already an open IN_PROGRESS count for that store", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([{ id: "s1" }] as never)
    vi.mocked(prisma.stockCount.findFirst).mockResolvedValue({ id: "existing-count" } as never)

    const result = await createStockCount({ storeId: "s1", countedAt: new Date("2026-05-07") })
    expect(result).toEqual({ ok: false, error: "in_progress_count_exists", existingCountId: "existing-count" })
    expect(prisma.stockCount.create).not.toHaveBeenCalled()
  })
})

describe("saveStockCountLine", () => {
  beforeEach(() => {
    // Default: session OK, count exists in caller's account, in IN_PROGRESS, ingredient lives in account.
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.stockCount.findUnique).mockResolvedValue({
      id: "c1",
      storeId: "s1",
      status: "IN_PROGRESS",
      store: { accountId: "acct-A" },
    } as never)
    vi.mocked(prisma.canonicalIngredient.findUnique).mockResolvedValue({
      id: "ing1",
      accountId: "acct-A",
      recipeUnit: "lb",
    } as never)
    vi.mocked(prisma.ingredientSkuMatch.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.stockCountLine.upsert).mockResolvedValue({ id: "l1" } as never)
  })

  it("returns null when no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const result = await saveStockCountLine({
      stockCountId: "c1",
      canonicalIngredientId: "ing1",
      nativeQty: 5,
      nativeUnit: "lb",
    })
    expect(result).toBeNull()
  })

  it("rejects when the count belongs to a different account", async () => {
    vi.mocked(prisma.stockCount.findUnique).mockResolvedValue({
      id: "c1",
      storeId: "s1",
      status: "IN_PROGRESS",
      store: { accountId: "acct-B" },
    } as never)
    const result = await saveStockCountLine({
      stockCountId: "c1",
      canonicalIngredientId: "ing1",
      nativeQty: 5,
      nativeUnit: "lb",
    })
    expect(result).toEqual({ ok: false, error: "count_not_in_account" })
  })

  it("rejects when the count is COMPLETED (no edits after finalization)", async () => {
    vi.mocked(prisma.stockCount.findUnique).mockResolvedValue({
      id: "c1",
      storeId: "s1",
      status: "COMPLETED",
      store: { accountId: "acct-A" },
    } as never)
    const result = await saveStockCountLine({
      stockCountId: "c1",
      canonicalIngredientId: "ing1",
      nativeQty: 5,
      nativeUnit: "lb",
    })
    expect(result).toEqual({ ok: false, error: "count_not_in_progress" })
  })

  it("rejects when the ingredient belongs to a different account", async () => {
    vi.mocked(prisma.canonicalIngredient.findUnique).mockResolvedValue({
      id: "ing1",
      accountId: "acct-B",
      recipeUnit: "lb",
    } as never)
    const result = await saveStockCountLine({
      stockCountId: "c1",
      canonicalIngredientId: "ing1",
      nativeQty: 5,
      nativeUnit: "lb",
    })
    expect(result).toEqual({ ok: false, error: "ingredient_not_in_account" })
  })

  it("upserts a line at native unit == recipe unit (no conversion needed)", async () => {
    const result = await saveStockCountLine({
      stockCountId: "c1",
      canonicalIngredientId: "ing1",
      nativeQty: 5,
      nativeUnit: "lb",
    })
    expect(result).toEqual({ ok: true, lineId: "l1", qtyInRecipeUnit: 5 })
    expect(prisma.stockCountLine.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stockCountId_canonicalIngredientId: { stockCountId: "c1", canonicalIngredientId: "ing1" } },
        create: expect.objectContaining({
          stockCountId: "c1",
          canonicalIngredientId: "ing1",
          qtyInRecipeUnit: 5,
          nativeQty: 5,
          nativeUnit: "lb",
        }),
        update: expect.objectContaining({
          qtyInRecipeUnit: 5,
          nativeQty: 5,
          nativeUnit: "lb",
        }),
      })
    )
  })

  it("converts native to recipe units using IngredientSkuMatch (case → lb at 16)", async () => {
    vi.mocked(prisma.ingredientSkuMatch.findMany).mockResolvedValue([
      { fromUnit: "case", toUnit: "lb", conversionFactor: 16 },
    ] as never)
    const result = await saveStockCountLine({
      stockCountId: "c1",
      canonicalIngredientId: "ing1",
      nativeQty: 2,
      nativeUnit: "case",
    })
    expect(result).toEqual({ ok: true, lineId: "l1", qtyInRecipeUnit: 32 })
    expect(prisma.stockCountLine.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ qtyInRecipeUnit: 32, nativeUnit: "case" }),
      })
    )
  })

  it("returns missing_conversion when units don't match and no conversion exists", async () => {
    vi.mocked(prisma.ingredientSkuMatch.findMany).mockResolvedValue([
      { fromUnit: "bag", toUnit: "lb", conversionFactor: 5 },
    ] as never)
    const result = await saveStockCountLine({
      stockCountId: "c1",
      canonicalIngredientId: "ing1",
      nativeQty: 2,
      nativeUnit: "case",
    })
    expect(result).toEqual({
      ok: false,
      error: "missing_conversion",
      fromUnit: "case",
      toUnit: "lb",
    })
    expect(prisma.stockCountLine.upsert).not.toHaveBeenCalled()
  })

  it("rejects when the canonical ingredient has no recipeUnit set", async () => {
    vi.mocked(prisma.canonicalIngredient.findUnique).mockResolvedValue({
      id: "ing1",
      accountId: "acct-A",
      recipeUnit: null,
    } as never)
    const result = await saveStockCountLine({
      stockCountId: "c1",
      canonicalIngredientId: "ing1",
      nativeQty: 1,
      nativeUnit: "lb",
    })
    expect(result).toEqual({ ok: false, error: "ingredient_missing_recipe_unit" })
  })

  it("rejects negative qty before touching Prisma", async () => {
    const result = await saveStockCountLine({
      stockCountId: "c1",
      canonicalIngredientId: "ing1",
      nativeQty: -3,
      nativeUnit: "lb",
    })
    expect(result).toEqual({ ok: false, error: "invalid_qty" })
    expect(prisma.stockCountLine.upsert).not.toHaveBeenCalled()
  })
})

describe("completeStockCount", () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.stockCount.findUnique).mockResolvedValue({
      id: "c1",
      storeId: "s1",
      status: "IN_PROGRESS",
      store: { accountId: "acct-A" },
    } as never)
    vi.mocked(prisma.stockCount.update).mockResolvedValue({ id: "c1", status: "COMPLETED" } as never)
  })

  it("returns null when no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const result = await completeStockCount({ stockCountId: "c1" })
    expect(result).toBeNull()
  })

  it("rejects when count belongs to a different account", async () => {
    vi.mocked(prisma.stockCount.findUnique).mockResolvedValue({
      id: "c1",
      storeId: "s1",
      status: "IN_PROGRESS",
      store: { accountId: "acct-B" },
    } as never)
    const result = await completeStockCount({ stockCountId: "c1" })
    expect(result).toEqual({ ok: false, error: "count_not_in_account" })
  })

  it("rejects when count is already COMPLETED", async () => {
    vi.mocked(prisma.stockCount.findUnique).mockResolvedValue({
      id: "c1",
      storeId: "s1",
      status: "COMPLETED",
      store: { accountId: "acct-A" },
    } as never)
    const result = await completeStockCount({ stockCountId: "c1" })
    expect(result).toEqual({ ok: false, error: "count_not_in_progress" })
    expect(prisma.stockCount.update).not.toHaveBeenCalled()
  })

  it("transitions IN_PROGRESS → COMPLETED and stamps completedAt", async () => {
    const result = await completeStockCount({ stockCountId: "c1" })
    expect(result).toEqual({ ok: true })
    expect(prisma.stockCount.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "COMPLETED", completedAt: expect.any(Date) },
    })
  })

  it("runs calibration update before marking the count complete", async () => {
    const calibrationModule = await import("@/lib/inventory/calibration-update")
    const calls: string[] = []
    vi.mocked(calibrationModule.applyCalibrationUpdatesForCount).mockImplementation(
      (async () => {
        calls.push("calibration")
      }) as never,
    )
    vi.mocked(prisma.stockCount.update).mockImplementation((async () => {
      calls.push("update")
      return { id: "c1", status: "COMPLETED" }
    }) as never)
    await completeStockCount({ stockCountId: "c1" })
    expect(calls).toEqual(["calibration", "update"])
    expect(calibrationModule.applyCalibrationUpdatesForCount).toHaveBeenCalledWith("c1")
  })
})

describe("listStockCounts", () => {
  it("returns null when no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const result = await listStockCounts()
    expect(result).toBeNull()
  })

  it("scopes by accountId and returns most-recent first", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([{ id: "s1" }, { id: "s2" }] as never)
    vi.mocked(prisma.stockCount.findMany).mockResolvedValue([
      { id: "c2", countedAt: new Date("2026-05-07") },
      { id: "c1", countedAt: new Date("2026-04-30") },
    ] as never)
    const result = await listStockCounts()
    expect(result).toEqual([
      { id: "c2", countedAt: new Date("2026-05-07") },
      { id: "c1", countedAt: new Date("2026-04-30") },
    ])
    expect(prisma.stockCount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: { in: ["s1", "s2"] } },
        orderBy: { countedAt: "desc" },
      })
    )
  })

  it("narrows to a single storeId when one is provided and is in the account", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([{ id: "s1" }, { id: "s2" }] as never)
    vi.mocked(prisma.stockCount.findMany).mockResolvedValue([] as never)
    await listStockCounts({ storeId: "s1" })
    expect(prisma.stockCount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: { in: ["s1"] } } })
    )
  })
})
