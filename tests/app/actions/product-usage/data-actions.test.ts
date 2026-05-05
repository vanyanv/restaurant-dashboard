// Contract test: lock the response *shape* of getProductUsageData against a
// Zod schema so the split + helper extraction can be verified independent of
// changes in field values. Mocks Prisma + next-auth so we can call the action
// directly without a database. NOT an integration test — those would need a
// seeded test DB and live in a separate effort.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { z } from "zod"

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn() },
    invoiceLineItem: { findMany: vi.fn() },
    otterMenuItem: { findMany: vi.fn() },
    recipe: { findMany: vi.fn() },
    ingredientAlias: { findMany: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getProductUsageData } from "@/app/actions/product-usage/data-actions"

// Zod shape contract — every key in ProductUsageData with its scalar/list
// shape. Loose on row internals (z.array(z.any())) — the helper unit tests
// already cover the variance/aggregation math; this just guards against
// accidentally dropping a top-level key during the split.
const ProductUsageDataSchema = z.object({
  kpis: z.object({
    totalPurchasedCost: z.number(),
    theoreticalIngredientCost: z.number(),
    wasteEstimatedCost: z.number(),
    wastePercent: z.number(),
    ingredientsTracked: z.number(),
    recipesConfigured: z.number(),
    menuItemsCovered: z.number(),
  }),
  ingredientUsage: z.array(z.unknown()),
  menuItemCosts: z.array(z.unknown()),
  categoryBreakdown: z.array(z.unknown()),
  vendorPriceTrends: z.array(z.unknown()),
  priceAlerts: z.array(z.unknown()),
  orderAnomalies: z.array(z.unknown()),
  recipes: z.array(z.unknown()),
  dateRange: z.object({
    startDate: z.string(),
    endDate: z.string(),
  }),
  hasRecipes: z.boolean(),
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getProductUsageData — contract", () => {
  it("returns null when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const result = await getProductUsageData()
    expect(result).toBeNull()
  })

  it("returns null when the account owns no stores", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { accountId: "acct", id: "u1" },
    } as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([] as never)
    const result = await getProductUsageData()
    expect(result).toBeNull()
  })

  it("returns the documented ProductUsageData shape on the empty-data path", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { accountId: "acct", id: "u1" },
    } as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([{ id: "s1" }] as never)
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.ingredientAlias.findMany).mockResolvedValue([] as never)

    const result = await getProductUsageData()
    expect(result).not.toBeNull()
    // .parse throws on shape mismatch — assert it succeeds
    expect(() => ProductUsageDataSchema.parse(result)).not.toThrow()
    // Sanity: zero data → all rollups at zero
    expect(result!.kpis.totalPurchasedCost).toBe(0)
    expect(result!.ingredientUsage).toEqual([])
    expect(result!.hasRecipes).toBe(false)
  })

  it("respects the storeId scoping flag (single-store narrowing)", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { accountId: "acct", id: "u1" },
    } as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      { id: "s1" },
      { id: "s2" },
    ] as never)
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.ingredientAlias.findMany).mockResolvedValue([] as never)

    await getProductUsageData({ storeId: "s2" })

    // ingredientAlias filter should target only the requested store
    const aliasCall = vi.mocked(prisma.ingredientAlias.findMany).mock.calls[0]?.[0]
    expect(aliasCall).toEqual({ where: { storeId: { in: ["s2"] } } })
  })
})
