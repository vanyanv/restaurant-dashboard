// listPantryLedger — composes the spend-ranked ledger the Pantry page renders.
// Pins the three things the page's meaning depends on: rows ordered by 90-day
// spend (the live page is alphabetical, which buries a 31.9%-of-spend
// ingredient in row 24), the dollar impact of a price move (a percentage on
// its own cannot be acted on), and stations resolved through the real
// classifier so a miscategorised ingredient can't silently land in the wrong
// station.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth-scope", () => ({ getAuthScope: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/app/actions/canonical-ingredient-actions", () => ({
  listCanonicalIngredients: vi.fn(),
}))
vi.mock("@/lib/canonical-spend-batch", () => ({ batchCanonicalSpend: vi.fn() }))

import { getAuthScope } from "@/lib/auth-scope"
import { listCanonicalIngredients } from "@/app/actions/canonical-ingredient-actions"
import { batchCanonicalSpend } from "@/lib/canonical-spend-batch"
import { listPantryLedger } from "@/app/actions/pantry-ledger-actions"
import type { CanonicalIngredientSummary, IngredientTrend } from "@/types/recipe"
import type { CanonicalSpend } from "@/lib/canonical-spend-batch"

const canonical = (
  over: Partial<CanonicalIngredientSummary> & { id: string; name: string }
): CanonicalIngredientSummary => ({
  defaultUnit: "lb",
  category: null,
  aliasCount: 0,
  recipeUnit: "lb",
  costPerRecipeUnit: 1,
  costSource: "invoice",
  costLocked: false,
  costUpdatedAt: null,
  latestUnitCost: null,
  latestUnit: null,
  latestPriceAt: null,
  latestVendor: null,
  latestSku: null,
  trend30d: null,
  skuCount: 1,
  hasPhoto: false,
  photoVersion: null,
  caseUnit: null,
  innerPackUnit: null,
  recipeUnitsPerCase: null,
  innerPacksPerCase: null,
  ...over,
})

const trend = (pctChange: number): IngredientTrend => ({
  pctChange,
  latestPrice: 10,
  baselinePrice: 9,
  vendor: "Sysco",
  unit: "CS",
  sku: "A",
  latestDate: "2026-08-15",
  baselineDate: "2026-07-15",
})

const spend = (over: Partial<CanonicalSpend> = {}): CanonicalSpend => ({
  spend: 0,
  lineCount: 0,
  vendors: [],
  skus: [],
  lastPurchaseAt: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthScope).mockResolvedValue({ ownerId: "u1", accountId: "acct-1" })
})

describe("listPantryLedger", () => {
  it("returns empty data when there is no session", async () => {
    vi.mocked(getAuthScope).mockResolvedValue(null)
    const data = await listPantryLedger()
    expect(data.rows).toEqual([])
    expect(data.totals.spend).toBe(0)
    expect(listCanonicalIngredients).not.toHaveBeenCalled()
  })

  it("orders rows by 90-day spend, descending", async () => {
    vi.mocked(listCanonicalIngredients).mockResolvedValue([
      canonical({ id: "a", name: "american cheese", category: "Dairy" }),
      canonical({ id: "b", name: "ground beef fine grnd 73/27", category: "Meat" }),
      canonical({ id: "c", name: "mustard packets", category: "Dry Goods" }),
    ])
    vi.mocked(batchCanonicalSpend).mockResolvedValue(
      new Map([
        ["a", spend({ spend: 0 })],
        ["b", spend({ spend: 54_560 })],
        ["c", spend({ spend: 12 })],
      ])
    )

    const data = await listPantryLedger()
    expect(data.rows.map((r) => r.id)).toEqual(["b", "c", "a"])
  })

  it("converts a price move into a quarterly dollar impact", async () => {
    vi.mocked(listCanonicalIngredients).mockResolvedValue([
      canonical({ id: "a", name: "potato fry", category: "Frozen", trend30d: trend(45.5) }),
      canonical({ id: "b", name: "sanitizer", category: "Cleaning", trend30d: trend(5.2) }),
      canonical({ id: "c", name: "onion", category: "Produce", trend30d: null }),
    ])
    vi.mocked(batchCanonicalSpend).mockResolvedValue(
      new Map([
        ["a", spend({ spend: 16_042 })],
        ["b", spend({ spend: 500 })],
        ["c", spend({ spend: 3_480 })],
      ])
    )

    const data = await listPantryLedger()
    const byId = Object.fromEntries(data.rows.map((r) => [r.id, r]))
    expect(byId.a.impact90).toBeCloseTo(16_042 * 0.455, 0)
    expect(byId.b.impact90).toBeCloseTo(26, 0)
    // No trend means no impact — not zero, which would read as "no change".
    expect(byId.c.impact90).toBeNull()
  })

  it("resolves stations through the real classifier, not the stored category", async () => {
    vi.mocked(listCanonicalIngredients).mockResolvedValue([
      canonical({ id: "a", name: "chris & eddy's house sauce", category: "Other" }),
      canonical({ id: "b", name: "container foam hinged", category: "Paper/Supplies" }),
    ])
    vi.mocked(batchCanonicalSpend).mockResolvedValue(
      new Map([
        ["a", spend({ spend: 17_744 })],
        ["b", spend({ spend: 2_398 })],
      ])
    )

    const data = await listPantryLedger()
    const byId = Object.fromEntries(data.rows.map((r) => [r.id, r]))
    expect(byId.a.station).toBe("Sauce & Condiment")
    expect(byId.a.isPackaging).toBe(false)
    expect(byId.b.station).toBe("Packaging & Supplies")
    expect(byId.b.isPackaging).toBe(true)
  })

  it("splits totals into food and packaging", async () => {
    vi.mocked(listCanonicalIngredients).mockResolvedValue([
      canonical({ id: "a", name: "ground beef", category: "Meat" }),
      canonical({ id: "b", name: "container foam", category: "Paper/Supplies" }),
    ])
    vi.mocked(batchCanonicalSpend).mockResolvedValue(
      new Map([
        ["a", spend({ spend: 100 })],
        ["b", spend({ spend: 25 })],
      ])
    )

    const data = await listPantryLedger()
    expect(data.totals).toMatchObject({
      spend: 125,
      foodSpend: 100,
      packagingSpend: 25,
      count: 2,
      foodCount: 1,
      packagingCount: 1,
    })
  })

  it("sorts stations by spend but always ends with packaging", async () => {
    vi.mocked(listCanonicalIngredients).mockResolvedValue([
      canonical({ id: "a", name: "container foam", category: "Paper/Supplies" }),
      canonical({ id: "b", name: "ground beef", category: "Meat" }),
      canonical({ id: "c", name: "packer onion", category: "Produce" }),
    ])
    // Packaging outspends every food station here; it must still sort last.
    vi.mocked(batchCanonicalSpend).mockResolvedValue(
      new Map([
        ["a", spend({ spend: 900_000 })],
        ["b", spend({ spend: 100 })],
        ["c", spend({ spend: 50 })],
      ])
    )

    const data = await listPantryLedger()
    expect(data.stations.map((s) => s.station)).toEqual([
      "Beef & Protein",
      "Produce",
      "Packaging & Supplies",
    ])
    expect(data.stations[0]).toMatchObject({ itemCount: 1, spend: 100 })
  })

  it("carries spend provenance onto the row and defaults missing spend to zero", async () => {
    vi.mocked(listCanonicalIngredients).mockResolvedValue([
      canonical({ id: "a", name: "potato fry", category: "Frozen", skuCount: 3 }),
      canonical({ id: "b", name: "never bought", category: "Dry Goods" }),
    ])
    vi.mocked(batchCanonicalSpend).mockResolvedValue(
      new Map([
        [
          "a",
          spend({
            spend: 16_042,
            lineCount: 32,
            vendors: ["Sysco", "Vitco Foodservice"],
            skus: ["7441436", "2141760", "15185"],
            lastPurchaseAt: new Date("2026-08-15"),
          }),
        ],
      ])
    )

    const data = await listPantryLedger()
    const byId = Object.fromEntries(data.rows.map((r) => [r.id, r]))
    expect(byId.a).toMatchObject({ spend90: 16_042, lineCount: 32, skuCount: 3 })
    expect(byId.a.vendors).toEqual(["Sysco", "Vitco Foodservice"])
    expect(byId.a.skus).toHaveLength(3)
    expect(byId.b).toMatchObject({ spend90: 0, lineCount: 0, impact90: null })
    expect(byId.b.lastPurchaseAt).toBeNull()
  })
})
