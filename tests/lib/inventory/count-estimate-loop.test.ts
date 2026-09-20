// The closed loop, walked end to end with Prisma mocked.
//
// A stock count exists to produce a variance: counted quantity minus expected
// quantity. On this codebase it could never produce one, because the four
// links formed a ring:
//
//   1. `loadCountEntry` hard-coded `estimate: null` on every row.
//   2. The entry form carried that null through `recordCountLine` into
//      `saveStockCountLine`, which wrote `estimatedQtyAtCount: null`.
//   3. On close, `applyCalibrationUpdatesForCount` filtered to lines with a
//      non-null estimate and returned at `linesWithEstimate.length === 0`.
//   4. With no `IngredientModelState`, the reading was that there was no model
//      to produce an estimate — so (1) stayed null forever.
//
// Link 4 is the false one: an expectation does not come from
// `IngredientModelState` at all. It comes from the running-on-hand walk, which
// needs no calibration row — only a CLOSED count to anchor on. This test walks
// links 1 -> 2 -> 3 in order and asserts the ring is open.

import { describe, it, expect, vi, beforeEach } from "vitest"

const { db } = vi.hoisted(() => ({
  db: {
    stockCount: { findFirst: vi.fn(), findUnique: vi.fn() },
    stockCountLine: { findMany: vi.fn(), upsert: vi.fn() },
    canonicalIngredient: { findMany: vi.fn(), findUnique: vi.fn() },
    ingredientSkuMatch: { findMany: vi.fn() },
    ingredientModelState: { findUnique: vi.fn(), upsert: vi.fn() },
    store: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/prisma", () => ({ prisma: db }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: () => true }))
vi.mock("@/lib/inventory/store-inventory-context", () => ({
  loadStoreInventoryContext: vi.fn(),
  runningOnHandFromContext: vi.fn(),
}))
vi.mock("@/lib/inventory/running-on-hand", () => ({ computeRunningOnHand: vi.fn() }))

import { getServerSession } from "next-auth"
import {
  loadStoreInventoryContext,
  runningOnHandFromContext,
} from "@/lib/inventory/store-inventory-context"
import { computeRunningOnHand } from "@/lib/inventory/running-on-hand"
import { getCountSessionSectionPromises } from "@/lib/counter/adapters/stock-counts"
import { saveStockCountLine } from "@/app/actions/inventory/stock-count-actions"
import { applyCalibrationUpdatesForCount } from "@/lib/inventory/calibration-update"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const STARTED_AT = new Date("2026-09-18T21:04:00.000Z")
const COUNTED_AT = new Date("2026-09-18T21:04:00.000Z")
const PREVIOUS_CLOSE = new Date("2026-09-11T21:00:00.000Z")

beforeEach(() => {
  vi.clearAllMocks()
  asMock(getServerSession).mockResolvedValue({ user: { id: "u1", accountId: "acct_ours" } })
})

/** Link 1: the adapter hands the form an expectation for the open session. */
async function readExpectation(): Promise<number | null> {
  db.stockCount.findFirst.mockImplementation(
    async (args: { where: Record<string, unknown> }) =>
      args.where.status === "COMPLETED"
        ? { id: "count_closed" }
        : { id: "count_ours", status: "IN_PROGRESS", storeId: "store_a", startedAt: STARTED_AT },
  )
  db.canonicalIngredient.findMany.mockResolvedValue([
    {
      id: "ci_beef",
      name: "beef",
      category: "Protein",
      recipeUnit: "oz",
      caseUnit: "CS",
      recipeUnitsPerCase: 160,
      innerPackUnit: null,
      innerPacksPerCase: null,
    },
  ])
  db.stockCountLine.findMany.mockResolvedValue([])
  asMock(loadStoreInventoryContext).mockResolvedValue({ storeId: "store_a" })
  asMock(runningOnHandFromContext).mockReturnValue({
    ingredientId: "ci_beef",
    baseQty: 180,
    baseAt: PREVIOUS_CLOSE, // the anchor: a count that actually closed
    deliveriesQty: 320,
    depletionQty: 287.5,
    adjustmentsQty: 0,
    onHand: 212.5,
    partial: false,
  })

  const section = await getCountSessionSectionPromises({
    countId: "count_ours",
    accountId: "acct_ours",
  }).entry
  if (section.status !== "ready") throw new Error(`entry was ${section.status}`)
  return section.data.rows[0].estimate
}

/** Link 2: the save writes it to `StockCountLine.estimatedQtyAtCount`. */
async function saveLine(estimate: number | null): Promise<number | null> {
  db.stockCount.findUnique.mockResolvedValue({
    id: "count_ours",
    storeId: "store_a",
    status: "IN_PROGRESS",
    store: { accountId: "acct_ours" },
  })
  db.canonicalIngredient.findUnique.mockResolvedValue({
    id: "ci_beef",
    accountId: "acct_ours",
    recipeUnit: "oz",
  })
  db.ingredientSkuMatch.findMany.mockResolvedValue([])
  db.stockCountLine.upsert.mockResolvedValue({ id: "line_1" })

  const result = await saveStockCountLine({
    stockCountId: "count_ours",
    canonicalIngredientId: "ci_beef",
    nativeQty: 196,
    nativeUnit: "oz",
    estimatedQtyAtCount: estimate,
  })
  expect(result).toMatchObject({ ok: true })

  const written = db.stockCountLine.upsert.mock.calls[0][0] as {
    create: { estimatedQtyAtCount: number | null }
  }
  return written.create.estimatedQtyAtCount
}

describe("the count -> estimate -> calibration loop", () => {
  it("carries an expectation from the entry form through the save and into the model", async () => {
    // 1. The adapter produces one.
    const estimate = await readExpectation()
    expect(estimate).toBe(212.5)

    // 2. The save persists it, non-null.
    const persisted = await saveLine(estimate)
    expect(persisted).not.toBeNull()
    expect(persisted).toBe(212.5)

    // 3. Closing the count no longer early-returns at
    //    `linesWithEstimate.length === 0`.
    db.stockCount.findUnique.mockResolvedValue({
      id: "count_ours",
      storeId: "store_a",
      countedAt: COUNTED_AT,
      lines: [
        {
          canonicalIngredientId: "ci_beef",
          qtyInRecipeUnit: 196,
          estimatedQtyAtCount: persisted,
        },
      ],
    })
    db.ingredientModelState.findUnique.mockResolvedValue(null)
    asMock(computeRunningOnHand).mockResolvedValue({
      asOf: COUNTED_AT,
      storeId: "store_a",
      ingredientId: "ci_beef",
      ingredientName: "beef",
      recipeUnit: "oz",
      baseQty: 180,
      baseAt: PREVIOUS_CLOSE,
      deliveriesQty: 320,
      depletionQty: 287.5,
      adjustmentsQty: 0,
      onHand: 212.5,
      partial: false,
    })

    await applyCalibrationUpdatesForCount("count_ours")

    expect(db.ingredientModelState.upsert).toHaveBeenCalledTimes(1)
    const upserted = db.ingredientModelState.upsert.mock.calls[0][0] as {
      where: { storeId_canonicalIngredientId: { storeId: string; canonicalIngredientId: string } }
      create: { recountDeltaMean: number; sampleSize: number }
    }
    expect(upserted.where.storeId_canonicalIngredientId).toEqual({
      storeId: "store_a",
      canonicalIngredientId: "ci_beef",
    })
    // residual = expected 212.5 − counted 196 = 16.5 oz short. The first
    // number this account's on-hand model has ever been given.
    expect(upserted.create.recountDeltaMean).toBeCloseTo(16.5, 5)
    expect(upserted.create.sampleSize).toBe(1)
  })

  it("still early-returns for a count whose lines have no expectation", async () => {
    // Which is the correct outcome for the first count a store ever closes:
    // there was nothing to expect from, so there is nothing to learn.
    db.stockCount.findUnique.mockResolvedValue({
      id: "count_first",
      storeId: "store_a",
      countedAt: COUNTED_AT,
      lines: [
        { canonicalIngredientId: "ci_beef", qtyInRecipeUnit: 196, estimatedQtyAtCount: null },
      ],
    })

    await applyCalibrationUpdatesForCount("count_first")

    expect(db.ingredientModelState.upsert).not.toHaveBeenCalled()
  })

  it("a re-save with no expectation in hand does not erase the one already stored", async () => {
    // Two tabs, or a page that loaded before the store had a closed count.
    // Blurring a box in the stale one must not take the count's only training
    // signal with it.
    const persisted = await saveLine(null)
    expect(persisted).toBeNull()

    const written = db.stockCountLine.upsert.mock.calls[0][0] as {
      update: Record<string, unknown>
    }
    expect(written.update).not.toHaveProperty("estimatedQtyAtCount")
  })
})
