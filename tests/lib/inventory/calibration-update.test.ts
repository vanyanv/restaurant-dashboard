// applyCalibrationUpdatesForCount — runs at the moment a StockCount is being
// completed. For each line that has an estimatedQtyAtCount, derive a
// recount observation from the just-completed count + the prior anchor
// count, and upsert the per-(store, ingredient) IngredientModelState.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stockCount: { findUnique: vi.fn() },
    ingredientModelState: { upsert: vi.fn(), findUnique: vi.fn() },
  },
}))
vi.mock("@/lib/inventory/running-on-hand", () => ({
  computeRunningOnHand: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { computeRunningOnHand } from "@/lib/inventory/running-on-hand"
import { applyCalibrationUpdatesForCount } from "@/lib/inventory/calibration-update"

const countedAt = new Date("2026-05-08T18:00:00.000Z")
const baseAt = new Date("2026-05-01T18:00:00.000Z") // 7 days earlier

beforeEach(() => {
  vi.clearAllMocks()
})

function mockCount(lines: Array<{
  canonicalIngredientId: string
  qtyInRecipeUnit: number
  estimatedQtyAtCount: number | null
}>) {
  vi.mocked(prisma.stockCount.findUnique).mockResolvedValue({
    id: "sc-1",
    storeId: "s1",
    countedAt,
    lines,
  } as never)
}

function mockOnHand(overrides: Partial<{
  baseQty: number
  baseAt: Date | null
  deliveriesQty: number
  depletionQty: number
  adjustmentsQty: number
}>) {
  vi.mocked(computeRunningOnHand).mockResolvedValue({
    asOf: countedAt,
    storeId: "s1",
    ingredientId: "ing-1",
    ingredientName: "Mozzarella",
    recipeUnit: "lb",
    baseQty: 0,
    baseAt: null,
    deliveriesQty: 0,
    depletionQty: 0,
    adjustmentsQty: 0,
    onHand: 0,
    partial: false,
    ...overrides,
  } as never)
}

describe("applyCalibrationUpdatesForCount", () => {
  it("returns silently when the count does not exist", async () => {
    vi.mocked(prisma.stockCount.findUnique).mockResolvedValue(null as never)
    await applyCalibrationUpdatesForCount("missing")
    expect(prisma.ingredientModelState.upsert).not.toHaveBeenCalled()
  })

  it("skips lines without an estimatedQtyAtCount (no training signal)", async () => {
    mockCount([
      { canonicalIngredientId: "ing-1", qtyInRecipeUnit: 5, estimatedQtyAtCount: null },
    ])
    await applyCalibrationUpdatesForCount("sc-1")
    expect(prisma.ingredientModelState.upsert).not.toHaveBeenCalled()
    expect(computeRunningOnHand).not.toHaveBeenCalled()
  })

  it("computes residual + observation and upserts state for each line with an estimate", async () => {
    mockCount([
      { canonicalIngredientId: "ing-1", qtyInRecipeUnit: 6, estimatedQtyAtCount: 7 },
    ])
    mockOnHand({
      baseQty: 10,
      baseAt,
      deliveriesQty: 5,
      depletionQty: 8, // theoretical (uncalibrated recipe-walk)
      adjustmentsQty: 1,
    })
    vi.mocked(prisma.ingredientModelState.findUnique).mockResolvedValue(null as never)

    await applyCalibrationUpdatesForCount("sc-1")

    expect(computeRunningOnHand).toHaveBeenCalledWith({
      storeId: "s1",
      ingredientId: "ing-1",
      asOf: countedAt,
    })
    const upsertArg = vi.mocked(prisma.ingredientModelState.upsert).mock.calls[0][0] as {
      where: { storeId_canonicalIngredientId: { storeId: string; canonicalIngredientId: string } }
      create: { calibrationFactor: number; recountDeltaMean: number; sampleSize: number }
      update: { calibrationFactor: number; sampleSize: number; recountDeltaMean: number }
    }
    expect(upsertArg.where.storeId_canonicalIngredientId).toEqual({
      storeId: "s1",
      canonicalIngredientId: "ing-1",
    })
    // observed = 10 + 5 − 1 − 6 = 8; theoretical = 8 → observation = 1.0 → factor stays 1.0
    expect(upsertArg.create.calibrationFactor).toBeCloseTo(1.0, 5)
    // residual = 7 − 6 = 1.0
    expect(upsertArg.create.recountDeltaMean).toBeCloseTo(1.0, 5)
    expect(upsertArg.create.sampleSize).toBe(1)
  })

  it("falls back to a 7-day weeklyThroughput when there is no prior count", async () => {
    mockCount([
      { canonicalIngredientId: "ing-1", qtyInRecipeUnit: 4, estimatedQtyAtCount: 4 },
    ])
    mockOnHand({
      baseQty: 0,
      baseAt: null, // no anchor
      deliveriesQty: 10,
      depletionQty: 6,
      adjustmentsQty: 0,
    })
    vi.mocked(prisma.ingredientModelState.findUnique).mockResolvedValue(null as never)

    await applyCalibrationUpdatesForCount("sc-1")
    // observed = 0 + 10 − 0 − 4 = 6; throughput defaults to observed (period treated as 7d)
    // residual = 0 → consecutiveTightWeeks = 1
    const upsertArg = vi.mocked(prisma.ingredientModelState.upsert).mock.calls[0][0] as {
      create: { consecutiveTightWeeks: number; recountDeltaMean: number }
    }
    expect(upsertArg.create.recountDeltaMean).toBe(0)
    expect(upsertArg.create.consecutiveTightWeeks).toBe(1)
  })

  it("scales weeklyThroughput by (period / 7d) so a 14-day window halves the throughput", async () => {
    mockCount([
      { canonicalIngredientId: "ing-1", qtyInRecipeUnit: 0, estimatedQtyAtCount: 0 },
    ])
    const longBaseAt = new Date(countedAt.getTime() - 14 * 24 * 3600 * 1000)
    mockOnHand({
      baseQty: 14,
      baseAt: longBaseAt,
      deliveriesQty: 0,
      depletionQty: 14,
      adjustmentsQty: 0,
    })
    vi.mocked(prisma.ingredientModelState.findUnique).mockResolvedValue(null as never)

    await applyCalibrationUpdatesForCount("sc-1")
    // observed = 14 over 14d = 7/week. residual = 0 so this is a tight week.
    const upsertArg = vi.mocked(prisma.ingredientModelState.upsert).mock.calls[0][0] as {
      create: { consecutiveTightWeeks: number }
    }
    expect(upsertArg.create.consecutiveTightWeeks).toBe(1)
  })

  it("layers an update on top of an existing ModelState", async () => {
    mockCount([
      { canonicalIngredientId: "ing-1", qtyInRecipeUnit: 5, estimatedQtyAtCount: 5 },
    ])
    mockOnHand({
      baseQty: 10,
      baseAt,
      deliveriesQty: 0,
      depletionQty: 5,
      adjustmentsQty: 0,
    })
    vi.mocked(prisma.ingredientModelState.findUnique).mockResolvedValue({
      calibrationFactor: 1.2,
      recountDeltaMean: 0.5,
      recountDeltaM2: 1.0,
      sampleSize: 4,
      consecutiveTightWeeks: 2,
      isGraduated: false,
      graduatedAt: null,
    } as never)

    await applyCalibrationUpdatesForCount("sc-1")

    const upsertArg = vi.mocked(prisma.ingredientModelState.upsert).mock.calls[0][0] as {
      update: { sampleSize: number; consecutiveTightWeeks: number; calibrationFactor: number }
    }
    expect(upsertArg.update.sampleSize).toBe(5)
    expect(upsertArg.update.consecutiveTightWeeks).toBe(3) // residual 0 → tight
    // observation = 5/5 = 1; prior 1.2 → 1.2*0.7 + 1.0*0.3 = 1.14
    expect(upsertArg.update.calibrationFactor).toBeCloseTo(1.14, 5)
  })

  it("handles multiple lines independently", async () => {
    mockCount([
      { canonicalIngredientId: "ing-1", qtyInRecipeUnit: 5, estimatedQtyAtCount: 5 },
      { canonicalIngredientId: "ing-2", qtyInRecipeUnit: 10, estimatedQtyAtCount: 12 },
    ])
    vi.mocked(computeRunningOnHand).mockImplementation((async ({ ingredientId }: { ingredientId: string }) => ({
      asOf: countedAt,
      storeId: "s1",
      ingredientId,
      ingredientName: ingredientId,
      recipeUnit: "lb",
      baseQty: 0,
      baseAt,
      deliveriesQty: 20,
      depletionQty: 15,
      adjustmentsQty: 0,
      onHand: 0,
      partial: false,
    })) as never)
    vi.mocked(prisma.ingredientModelState.findUnique).mockResolvedValue(null as never)

    await applyCalibrationUpdatesForCount("sc-1")
    expect(prisma.ingredientModelState.upsert).toHaveBeenCalledTimes(2)
  })
})
