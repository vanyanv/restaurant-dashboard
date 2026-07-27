// getCanonicalIngredientCost — the invoice→ingredient price resolver used by
// every recipe cost walk. Pins the store-scoped query preference with
// cross-store fallback, the spike-guard integration (rejected newest line →
// older price chosen + costGuardTriggered), and the asOf date clamp.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    canonicalIngredient: { findUnique: vi.fn() },
    invoiceLineItem: { findMany: vi.fn(), findFirst: vi.fn() },
    ingredientSkuMatch: { findFirst: vi.fn() },
    ingredientAlias: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { prisma } from "@/lib/prisma"
import { getCanonicalIngredientCost } from "@/lib/canonical-ingredients"

const CANONICAL_ID = "can-1"

/** Canonical with no stored cost → forces the period-matched invoice path.
 * recipeUnit null keeps resolveLineUnitCost on the raw extendedPrice/quantity
 * path so line costs in tests are literal. */
const bareCanonical = {
  recipeUnit: null,
  costPerRecipeUnit: null,
  costSource: null,
  costUpdatedAt: null,
}

let lineSeq = 0
function line(unitCost: number, invoiceDate: string) {
  lineSeq++
  return {
    id: `line-${lineSeq}`,
    invoiceId: `inv-${lineSeq}`,
    sku: null,
    productName: "Beef Patty",
    quantity: 1,
    unit: "lb",
    packSize: null,
    unitSize: null,
    unitSizeUom: null,
    unitPrice: unitCost,
    extendedPrice: unitCost, // quantity 1 → raw cost = extendedPrice
    invoice: { invoiceDate: new Date(invoiceDate), vendorName: "Sysco" },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  lineSeq = 0
  vi.mocked(prisma.canonicalIngredient.findUnique).mockResolvedValue(bareCanonical as never)
  vi.mocked(prisma.ingredientAlias.findMany).mockResolvedValue([] as never)
})

describe("getCanonicalIngredientCost — store scoping", () => {
  it("prefers this store's own invoice lines and skips the cross-store query when they exist", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      line(4.5, "2026-07-18"),
    ] as never)

    const result = await getCanonicalIngredientCost(CANONICAL_ID, undefined, {
      storeId: "store-1",
    })

    expect(result?.unitCost).toBe(4.5)
    expect(prisma.invoiceLineItem.findMany).toHaveBeenCalledTimes(1)
    const where = vi.mocked(prisma.invoiceLineItem.findMany).mock.calls[0][0]?.where
    expect(where?.invoice).toMatchObject({ storeId: "store-1" })
  })

  it("falls back to cross-store lines when the store-scoped query is empty", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany)
      .mockResolvedValueOnce([] as never) // store-scoped: nothing
      .mockResolvedValueOnce([line(3.25, "2026-07-15")] as never) // cross-store

    const result = await getCanonicalIngredientCost(CANONICAL_ID, undefined, {
      storeId: "store-new",
    })

    expect(result?.unitCost).toBe(3.25)
    expect(prisma.invoiceLineItem.findMany).toHaveBeenCalledTimes(2)
    const secondWhere = vi.mocked(prisma.invoiceLineItem.findMany).mock.calls[1][0]?.where
    expect(secondWhere?.invoice).toBeUndefined() // no asOf, no store scope
  })

  it("clamps the invoice window to asOf in both queries", async () => {
    const asOf = new Date("2026-07-01T00:00:00Z")
    vi.mocked(prisma.invoiceLineItem.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([line(2.0, "2026-06-28")] as never)

    await getCanonicalIngredientCost(CANONICAL_ID, asOf, { storeId: "store-1" })

    const calls = vi.mocked(prisma.invoiceLineItem.findMany).mock.calls
    expect(calls[0][0]?.where?.invoice).toMatchObject({
      storeId: "store-1",
      invoiceDate: { lte: asOf },
    })
    expect(calls[1][0]?.where?.invoice).toMatchObject({ invoiceDate: { lte: asOf } })
  })
})

describe("getCanonicalIngredientCost — spike guard integration", () => {
  it("rejects a spiked newest line, returns the older sane price with costGuardTriggered", async () => {
    // Newest line is 81× the older median of 1.0 → guard rejects index 0.
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      line(81, "2026-07-19"),
      line(1.0, "2026-07-12"),
      line(1.1, "2026-07-05"),
      line(0.9, "2026-06-28"),
    ] as never)

    const result = await getCanonicalIngredientCost(CANONICAL_ID, undefined, {
      storeId: "store-1",
    })

    expect(result?.unitCost).toBe(1.0)
    expect(result?.costGuardTriggered).toBe(true)
    expect(result?.sourceLineItemId).toBe("line-2")
  })

  it("keeps the newest line and reports no guard trigger for ordinary price moves", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      line(3.0, "2026-07-19"),
      line(1.0, "2026-07-12"),
      line(1.1, "2026-07-05"),
    ] as never)

    const result = await getCanonicalIngredientCost(CANONICAL_ID, undefined, {
      storeId: "store-1",
    })

    expect(result?.unitCost).toBe(3.0)
    expect(result?.costGuardTriggered).toBe(false)
    expect(result?.source).toBe("invoice")
  })
})
