// getWasteRootCauses — joins StockCountLine residuals + adjustments to
// label each (store, ingredient) with a waste-cluster classification.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findUnique: vi.fn(), findMany: vi.fn() },
    stockCountLine: { findMany: vi.fn() },
    inventoryAdjustment: { findMany: vi.fn() },
    canonicalIngredient: { findMany: vi.fn() },
    ingredientModelState: { findMany: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getWasteRootCauses } from "@/app/actions/forecasts/waste-cluster-actions"

const sessionWith = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
  // Default aggregate-mode store list; scoped tests override findUnique below.
  vi.mocked(prisma.store.findMany).mockResolvedValue([
    { id: "store-A", name: "Store A" },
  ] as never)
  vi.mocked(prisma.inventoryAdjustment.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.ingredientModelState.findMany).mockResolvedValue([] as never)
})

interface LineFx {
  storeId?: string
  canonicalIngredientId: string
  date: string
  estimated: number
  actual: number
}

function line(l: LineFx) {
  return {
    canonicalIngredientId: l.canonicalIngredientId,
    qtyInRecipeUnit: l.actual,
    estimatedQtyAtCount: l.estimated,
    stockCount: {
      storeId: l.storeId ?? "store-A",
      countedAt: new Date(`${l.date}T00:00:00Z`),
    },
  }
}

describe("getWasteRootCauses", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getWasteRootCauses({})).toBeNull()
  })

  it("guards cross-account storeId", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "stranger",
      name: "Stranger",
      accountId: "acct-OTHER",
    } as never)
    expect(await getWasteRootCauses({ storeId: "stranger" })).toEqual({
      ok: false,
      error: "store_not_in_account",
    })
  })

  it("returns no_data when there are no completed counts with frozen estimates", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.stockCountLine.findMany).mockResolvedValue([] as never)
    expect(await getWasteRootCauses({})).toEqual({
      ok: false,
      error: "no_data",
    })
  })

  it("classifies a high-bias / no-explanation ingredient as theft_or_unrecorded and surfaces it first", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)

    vi.mocked(prisma.stockCountLine.findMany).mockResolvedValue([
      line({ canonicalIngredientId: "i-1", date: "2026-04-01", estimated: 50, actual: 38 }),
      line({ canonicalIngredientId: "i-1", date: "2026-04-08", estimated: 50, actual: 37 }),
      line({ canonicalIngredientId: "i-1", date: "2026-04-15", estimated: 50, actual: 39 }),
      line({ canonicalIngredientId: "i-1", date: "2026-04-22", estimated: 50, actual: 38 }),
      line({ canonicalIngredientId: "i-2", date: "2026-04-01", estimated: 100, actual: 99 }),
      line({ canonicalIngredientId: "i-2", date: "2026-04-08", estimated: 100, actual: 101 }),
      line({ canonicalIngredientId: "i-2", date: "2026-04-15", estimated: 100, actual: 100 }),
    ] as never)

    vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([
      { id: "i-1", name: "Bacon", defaultUnit: "lb", costPerRecipeUnit: 4 },
      { id: "i-2", name: "Lettuce", defaultUnit: "head", costPerRecipeUnit: 1 },
    ] as never)

    vi.mocked(prisma.ingredientModelState.findMany).mockResolvedValue([
      {
        storeId: "store-A",
        canonicalIngredientId: "i-1",
        typicalWeeklyThroughput: 100,
      },
      {
        storeId: "store-A",
        canonicalIngredientId: "i-2",
        typicalWeeklyThroughput: 200,
      },
    ] as never)

    const result = await getWasteRootCauses({
      asOf: new Date("2026-05-08T00:00:00Z"),
    })
    if (!result || !result.ok) throw new Error("expected ok")

    const baconRow = result.data.rows.find(
      (r) => r.canonicalIngredientId === "i-1",
    )!
    expect(baconRow.classification.label).toBe("theft_or_unrecorded")
    // Bias mean ≈ 12, throughput 100 → ~12% (above the 10% strong-bias bar).
    expect(baconRow.classification.meanResidualPctOfThroughput).toBeGreaterThan(
      0.1,
    )
    // Annualized exposure ≈ 12 × $4 × 52 ≈ $2,496
    expect(baconRow.annualizedDollarExposure).toBeGreaterThan(2000)
    // Sorted by exposure desc — bacon (~$2.5k) before lettuce (~$50)
    expect(result.data.rows[0].canonicalIngredientId).toBe("i-1")
    expect(result.data.summary.theft_or_unrecorded).toBe(1)
  })

  it("classifies a high-bias ingredient with logged expiry as systematic_overuse, not theft", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)

    vi.mocked(prisma.stockCountLine.findMany).mockResolvedValue([
      line({ canonicalIngredientId: "i-1", date: "2026-04-01", estimated: 50, actual: 38 }),
      line({ canonicalIngredientId: "i-1", date: "2026-04-08", estimated: 50, actual: 37 }),
      line({ canonicalIngredientId: "i-1", date: "2026-04-15", estimated: 50, actual: 39 }),
    ] as never)

    vi.mocked(prisma.inventoryAdjustment.findMany).mockResolvedValue([
      {
        storeId: "store-A",
        canonicalIngredientId: "i-1",
        reason: "EXPIRY",
        qty: 5,
      },
    ] as never)

    vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([
      { id: "i-1", name: "Lettuce", defaultUnit: "head", costPerRecipeUnit: 2 },
    ] as never)

    vi.mocked(prisma.ingredientModelState.findMany).mockResolvedValue([
      {
        storeId: "store-A",
        canonicalIngredientId: "i-1",
        typicalWeeklyThroughput: 100,
      },
    ] as never)

    const result = await getWasteRootCauses({
      asOf: new Date("2026-05-08T00:00:00Z"),
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.rows[0].classification.label).toBe(
      "systematic_overuse",
    )
    expect(result.data.summary.systematic_overuse).toBe(1)
  })

  it("aggregates summary counts across multiple ingredients", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)

    vi.mocked(prisma.stockCountLine.findMany).mockResolvedValue([
      // i-1: stable
      line({ canonicalIngredientId: "i-1", date: "2026-04-01", estimated: 100, actual: 100 }),
      line({ canonicalIngredientId: "i-1", date: "2026-04-08", estimated: 100, actual: 101 }),
      line({ canonicalIngredientId: "i-1", date: "2026-04-15", estimated: 100, actual: 99 }),
      // i-2: insufficient data
      line({ canonicalIngredientId: "i-2", date: "2026-04-01", estimated: 50, actual: 40 }),
    ] as never)

    vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([
      { id: "i-1", name: "A", defaultUnit: "u", costPerRecipeUnit: 1 },
      { id: "i-2", name: "B", defaultUnit: "u", costPerRecipeUnit: 1 },
    ] as never)

    vi.mocked(prisma.ingredientModelState.findMany).mockResolvedValue([
      {
        storeId: "store-A",
        canonicalIngredientId: "i-1",
        typicalWeeklyThroughput: 100,
      },
      {
        storeId: "store-A",
        canonicalIngredientId: "i-2",
        typicalWeeklyThroughput: 100,
      },
    ] as never)

    const result = await getWasteRootCauses({
      asOf: new Date("2026-05-08T00:00:00Z"),
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.summary.stable_within_noise).toBe(1)
    expect(result.data.summary.insufficient_data).toBe(1)
  })
})
