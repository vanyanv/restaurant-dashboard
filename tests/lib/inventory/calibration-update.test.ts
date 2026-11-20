// applyCalibrationUpdatesForCount — runs at the moment a StockCount is being
// completed. For each line that has an estimatedQtyAtCount, derive a
// recount observation from the just-completed count + the prior anchor
// count, and upsert the per-(store, ingredient) IngredientModelState.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stockCount: { findFirst: vi.fn() },
    canonicalIngredient: { findMany: vi.fn() },
    ingredientModelState: { findMany: vi.fn(), createMany: vi.fn((arg) => ({ op: "createMany", a: [arg] })) },
    $executeRaw: vi.fn((...a) => ({ op: "executeRaw", a })),
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}))
vi.mock("@/lib/inventory/store-inventory-context", () => ({
  loadStoreInventoryContext: vi.fn(),
  runningOnHandFromContext: vi.fn(),
}))

import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { loadStoreInventoryContext, runningOnHandFromContext } from "@/lib/inventory/store-inventory-context"
import { applyCalibrationUpdatesForCount } from "@/lib/inventory/calibration-update"

const countedAt = new Date("2026-05-08T18:00:00.000Z")
const baseAt = new Date("2026-05-01T18:00:00.000Z") // 7 days earlier

const ctx = { storeId: "s1" }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadStoreInventoryContext).mockResolvedValue(ctx as never)
  vi.mocked(prisma.canonicalIngredient.findMany).mockImplementation((async (args: { where: { id: { in: string[] } } }) =>
    args.where.id.in.map((id) => ({ id, name: id, recipeUnit: "lb", caseUnit: null, recipeUnitsPerCase: null, innerPackUnit: null, innerPacksPerCase: null }))) as never)
  vi.mocked(prisma.ingredientModelState.findMany).mockResolvedValue([] as never)
})

/** What the transaction was handed: the createMany rows and the raw UPDATE's values. */
function written() {
  const ops = (vi.mocked(prisma.$transaction).mock.calls[0]?.[0] ?? []) as unknown as Array<{ op: string; a: unknown[] }>
  const created = ops.filter((o) => o.op === "createMany").flatMap((o) => (o.a[0] as { data: Array<Record<string, unknown>> }).data)
  const raw = ops.find((o) => o.op === "executeRaw")
  return { created, raw, ops }
}

function mockCount(lines: Array<{
  canonicalIngredientId: string
  qtyInRecipeUnit: number
  estimatedQtyAtCount: number | null
}>) {
  vi.mocked(prisma.stockCount.findFirst).mockResolvedValue({
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
  vi.mocked(runningOnHandFromContext).mockReturnValue({
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
    vi.mocked(prisma.stockCount.findFirst).mockResolvedValue(null as never)
    await applyCalibrationUpdatesForCount("missing", "acct-A")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("skips lines without an estimatedQtyAtCount (no training signal)", async () => {
    mockCount([
      { canonicalIngredientId: "ing-1", qtyInRecipeUnit: 5, estimatedQtyAtCount: null },
    ])
    await applyCalibrationUpdatesForCount("sc-1", "acct-A")
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(loadStoreInventoryContext).not.toHaveBeenCalled()
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

    await applyCalibrationUpdatesForCount("sc-1", "acct-A")

    // The store's inventory context is loaded once, as of the count's moment.
    expect(loadStoreInventoryContext).toHaveBeenCalledTimes(1)
    expect(loadStoreInventoryContext).toHaveBeenCalledWith({ storeId: "s1", accountId: "acct-A", asOf: countedAt })
    expect(vi.mocked(runningOnHandFromContext).mock.calls[0][0]).toBe(ctx)
    expect(vi.mocked(runningOnHandFromContext).mock.calls[0][1]).toMatchObject({ id: "ing-1" })
    expect(written().created).toHaveLength(1)
    const upsertArg = { create: written().created[0] } as {
      create: { storeId: string; canonicalIngredientId: string; calibrationFactor: number; recountDeltaMean: number; sampleSize: number }
    }
    expect(upsertArg.create).toMatchObject({ storeId: "s1", canonicalIngredientId: "ing-1" })
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

    await applyCalibrationUpdatesForCount("sc-1", "acct-A")
    // observed = 0 + 10 − 0 − 4 = 6; throughput defaults to observed (period treated as 7d)
    // residual = 0 → consecutiveTightWeeks = 1
    const upsertArg = { create: written().created[0] } as {
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

    await applyCalibrationUpdatesForCount("sc-1", "acct-A")
    // observed = 14 over 14d = 7/week. residual = 0 so this is a tight week.
    const upsertArg = { create: written().created[0] } as {
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
    vi.mocked(prisma.ingredientModelState.findMany).mockResolvedValue([{
      canonicalIngredientId: "ing-1",
      calibrationFactor: 1.2,
      recountDeltaMean: 0.5,
      recountDeltaM2: 1.0,
      sampleSize: 4,
      consecutiveTightWeeks: 2,
      isGraduated: false,
      graduatedAt: null,
    }] as never)

    await applyCalibrationUpdatesForCount("sc-1", "acct-A")

    // An ingredient with a state on file is UPDATED (one raw statement), not created.
    expect(written().created).toHaveLength(0)
    const raw = written().raw as unknown as { a: [TemplateStringsArray, ...unknown[]] }
    const sql = Prisma.sql(raw.a[0], ...raw.a.slice(1))
    expect(sql.sql).toContain('UPDATE "IngredientModelState"')
    // (cid, factor, mean, m2, sampleSize, tightWeeks, graduated, graduatedAt, level, throughput, updatedAt), storeId last
    const [cid, factor, , , sampleSize, tightWeeks] = sql.values as [string, number, number, number, number, number]
    expect(cid).toBe("ing-1")
    expect(sampleSize).toBe(5)
    expect(tightWeeks).toBe(3) // residual 0 → tight
    // observation = 5/5 = 1; prior 1.2 → 1.2*0.7 + 1.0*0.3 = 1.14
    expect(factor).toBeCloseTo(1.14, 5)
  })

  it("handles multiple lines independently", async () => {
    mockCount([
      { canonicalIngredientId: "ing-1", qtyInRecipeUnit: 5, estimatedQtyAtCount: 5 },
      { canonicalIngredientId: "ing-2", qtyInRecipeUnit: 10, estimatedQtyAtCount: 12 },
    ])
    vi.mocked(runningOnHandFromContext).mockImplementation(((_ctx: unknown, { id: ingredientId }: { id: string }) => ({
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

    await applyCalibrationUpdatesForCount("sc-1", "acct-A")
    expect(written().created.map((c) => c.canonicalIngredientId)).toEqual(["ing-1", "ing-2"])
    // …and the number of queries does not grow with the lines: one context
    // load, one ingredient read, one prior-state read, one transaction.
    expect(loadStoreInventoryContext).toHaveBeenCalledTimes(1)
    expect(prisma.canonicalIngredient.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.ingredientModelState.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)

  })

  it("skips a line whose ingredient is not on this account, as a missing ingredient was skipped", async () => {
    mockCount([
      { canonicalIngredientId: "ing-1", qtyInRecipeUnit: 5, estimatedQtyAtCount: 5 },
      { canonicalIngredientId: "ing-gone", qtyInRecipeUnit: 5, estimatedQtyAtCount: 5 },
    ])
    mockOnHand({ baseQty: 10, baseAt, depletionQty: 5 })
    vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([
      { id: "ing-1", name: "Mozzarella", recipeUnit: "lb", caseUnit: null, recipeUnitsPerCase: null, innerPackUnit: null, innerPacksPerCase: null },
    ] as never)
    await applyCalibrationUpdatesForCount("sc-1", "acct-A")
    expect(written().created.map((c) => c.canonicalIngredientId)).toEqual(["ing-1"])
    expect(vi.mocked(prisma.canonicalIngredient.findMany).mock.calls[0][0]?.where).toMatchObject({ accountId: "acct-A" })
    expect(vi.mocked(prisma.stockCount.findFirst).mock.calls[0][0]?.where).toMatchObject({ store: { accountId: "acct-A" } })
  })
})

describe("applyCalibrationUpdatesForCount with a status flip (one transaction)", () => {
  /** An interactive-transaction client that logs every call in order. */
  function interactiveTx(flipped: boolean) {
    const log: string[] = []
    const txClient = {
      stockCount: {
        updateMany: vi.fn(async () => {
          log.push("flip")
          return { count: flipped ? 1 : 0 }
        }),
      },
      $executeRaw: vi.fn(async () => {
        log.push("update-states")
        return 1
      }),
      ingredientModelState: {
        createMany: vi.fn(async (arg: { data: unknown[] }) => {
          log.push("create-states")
          return { count: arg.data.length }
        }),
      },
    }
    vi.mocked(prisma.$transaction).mockImplementation((async (arg: unknown) =>
      typeof arg === "function" ? (arg as (t: unknown) => unknown)(txClient) : arg) as never)
    const finish = async (tx: Prisma.TransactionClient) => {
      const done = await tx.stockCount.updateMany({
        where: { id: "sc-1", status: "IN_PROGRESS" },
        data: { status: "COMPLETED" },
      })
      return done.count > 0
    }
    return { log, txClient, finish }
  }

  beforeEach(() => {
    mockCount([{ canonicalIngredientId: "ing-1", qtyInRecipeUnit: 6, estimatedQtyAtCount: 7 }])
    mockOnHand({ baseQty: 10, baseAt, deliveriesQty: 5, depletionQty: 8, adjustmentsQty: 1 })
  })

  it("flips the status first, then writes calibration on the same transaction client", async () => {
    const { log, txClient, finish } = interactiveTx(true)
    const ok = await applyCalibrationUpdatesForCount("sc-1", "acct-A", finish)
    expect(ok).toBe(true)
    expect(log).toEqual(["flip", "create-states"])
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    // Nothing went through the non-transactional client.
    expect(prisma.ingredientModelState.createMany).not.toHaveBeenCalled()
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    // Same figures as the batch path: factor 1.0, residual 1.0, one sample.
    const created = (txClient.ingredientModelState.createMany.mock.calls[0] as unknown as [{ data: Array<Record<string, number>> }])[0].data[0]
    expect(created.calibrationFactor).toBeCloseTo(1.0, 5)
    expect(created.recountDeltaMean).toBeCloseTo(1.0, 5)
    expect(created.sampleSize).toBe(1)
  })

  it("a second call (already COMPLETED) writes no calibration at all", async () => {
    const { log, finish } = interactiveTx(false)
    const ok = await applyCalibrationUpdatesForCount("sc-1", "acct-A", finish)
    expect(ok).toBe(false)
    expect(log).toEqual(["flip"])
  })

  it("updates existing model states through the transaction too", async () => {
    vi.mocked(prisma.ingredientModelState.findMany).mockResolvedValue([
      {
        canonicalIngredientId: "ing-1",
        calibrationFactor: 1,
        recountDeltaMean: 0,
        recountDeltaM2: 0,
        sampleSize: 3,
        consecutiveTightWeeks: 0,
        isGraduated: false,
        graduatedAt: null,
      },
    ] as never)
    const { log, finish } = interactiveTx(true)
    await applyCalibrationUpdatesForCount("sc-1", "acct-A", finish)
    expect(log).toEqual(["flip", "update-states"])
  })

  it("still flips a count that has nothing to calibrate", async () => {
    mockCount([{ canonicalIngredientId: "ing-1", qtyInRecipeUnit: 6, estimatedQtyAtCount: null }])
    const { log, finish } = interactiveTx(true)
    expect(await applyCalibrationUpdatesForCount("sc-1", "acct-A", finish)).toBe(true)
    expect(log).toEqual(["flip"])
  })
})
