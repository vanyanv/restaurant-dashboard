// getCountDetail — for /dashboard/operations/inventory/counts/[id]. Returns
// the count header plus per-ingredient (estimated, actual, delta, dollar
// impact) — the waste-delta report. Negative delta = we ended up with MORE
// than the model predicted (gain — likely under-counted depletion); positive
// delta = MISSING qty (true unexplained waste).

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stockCount: { findUnique: vi.fn() },
    stockCountLine: { findMany: vi.fn() },
    canonicalIngredient: { findMany: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getCountDetail } from "@/app/actions/inventory/count-detail-actions"

const session = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([] as never)
})

describe("getCountDetail", () => {
  it("returns null when no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const r = await getCountDetail({ stockCountId: "c1" })
    expect(r).toBeNull()
  })

  it("returns count_not_found when the count doesn't exist", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.stockCount.findUnique).mockResolvedValue(null)
    const r = await getCountDetail({ stockCountId: "c1" })
    expect(r).toEqual({ ok: false, error: "count_not_found" })
  })

  it("rejects a count from another account", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.stockCount.findUnique).mockResolvedValue({
      id: "c1",
      storeId: "s1",
      status: "COMPLETED",
      countedAt: new Date("2026-05-07"),
      completedAt: new Date("2026-05-07"),
      note: null,
      store: { accountId: "acct-OTHER", name: "X" },
    } as never)
    const r = await getCountDetail({ stockCountId: "c1" })
    expect(r).toEqual({ ok: false, error: "count_not_in_account" })
  })

  it("returns lines with delta = estimated − actual and dollar impact via costPerRecipeUnit", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.stockCount.findUnique).mockResolvedValue({
      id: "c1",
      storeId: "s1",
      status: "COMPLETED",
      countedAt: new Date("2026-05-07"),
      completedAt: new Date("2026-05-07"),
      note: null,
      store: { accountId: "acct-A", name: "Lakewood" },
    } as never)
    vi.mocked(prisma.stockCountLine.findMany).mockResolvedValue([
      {
        canonicalIngredientId: "ing-1",
        qtyInRecipeUnit: 6,
        nativeQty: 6,
        nativeUnit: "lb",
        estimatedQtyAtCount: 8,
        calibrationFactorAtCount: 1,
        note: null,
      },
      {
        canonicalIngredientId: "ing-2",
        qtyInRecipeUnit: 12,
        nativeQty: 12,
        nativeUnit: "head",
        estimatedQtyAtCount: 10,
        calibrationFactorAtCount: 1,
        note: null,
      },
      {
        canonicalIngredientId: "ing-3",
        qtyInRecipeUnit: 5,
        nativeQty: 5,
        nativeUnit: "each",
        estimatedQtyAtCount: null, // no estimate → no delta
        calibrationFactorAtCount: null,
        note: null,
      },
    ] as never)
    vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([
      { id: "ing-1", name: "Mozz", category: "Dairy", recipeUnit: "lb", costPerRecipeUnit: 4 },
      { id: "ing-2", name: "Romaine", category: "Produce", recipeUnit: "head", costPerRecipeUnit: 2 },
      { id: "ing-3", name: "Buns", category: "Bread", recipeUnit: "each", costPerRecipeUnit: 0.5 },
    ] as never)

    const r = await getCountDetail({ stockCountId: "c1" })
    expect(r?.ok).toBe(true)
    if (!r?.ok) return

    const moz = r.data.lines.find((l) => l.ingredientId === "ing-1")
    expect(moz?.deltaQty).toBe(2) // 8 − 6 = +2 missing
    expect(moz?.deltaCost).toBe(8) // 2 × $4

    const romaine = r.data.lines.find((l) => l.ingredientId === "ing-2")
    expect(romaine?.deltaQty).toBe(-2) // 10 − 12 = −2 (gain — under-counted depletion)
    expect(romaine?.deltaCost).toBe(-4)

    const buns = r.data.lines.find((l) => l.ingredientId === "ing-3")
    expect(buns?.deltaQty).toBeNull()
    expect(buns?.deltaCost).toBeNull()
  })

  it("totals only count lines that have a delta — ingredients with no estimate are excluded from totals", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.stockCount.findUnique).mockResolvedValue({
      id: "c1",
      storeId: "s1",
      status: "COMPLETED",
      countedAt: new Date("2026-05-07"),
      completedAt: new Date("2026-05-07"),
      note: null,
      store: { accountId: "acct-A", name: "Lakewood" },
    } as never)
    vi.mocked(prisma.stockCountLine.findMany).mockResolvedValue([
      {
        canonicalIngredientId: "ing-1",
        qtyInRecipeUnit: 6,
        nativeQty: 6,
        nativeUnit: "lb",
        estimatedQtyAtCount: 8,
        calibrationFactorAtCount: 1,
        note: null,
      },
      {
        canonicalIngredientId: "ing-3",
        qtyInRecipeUnit: 5,
        nativeQty: 5,
        nativeUnit: "each",
        estimatedQtyAtCount: null,
        calibrationFactorAtCount: null,
        note: null,
      },
    ] as never)
    vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([
      { id: "ing-1", name: "Mozz", category: "Dairy", recipeUnit: "lb", costPerRecipeUnit: 4 },
      { id: "ing-3", name: "Buns", category: "Bread", recipeUnit: "each", costPerRecipeUnit: 0.5 },
    ] as never)

    const r = await getCountDetail({ stockCountId: "c1" })
    if (!r?.ok) throw new Error("expected ok")
    expect(r.data.totalDeltaQty).toBe(2)
    expect(r.data.totalDeltaCost).toBe(8)
    expect(r.data.linesWithDelta).toBe(1)
  })
})
