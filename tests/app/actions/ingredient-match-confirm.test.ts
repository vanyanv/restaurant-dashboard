// Regression cover for the vendor-spelling bug: confirming a (vendor, sku)
// match on one invoice template must key and backfill by vendorMatchKey, not
// by the raw string on the invoice that happened to be clicked.
//
// Live symptom this locks down: Vitco spells itself "Vitco Foodservice" on
// some invoices and "VITCO FOODSERVICE" on others. Keying on the raw name let
// the two spellings own contradictory mappings for SKU 15725, and left five
// caps-spelled 15726 lines unmatched for six weeks after 15726 was confirmed.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoiceLineItem: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    ingredientSkuMatch: { upsert: vi.fn() },
    canonicalIngredient: { create: vi.fn() },
    ingredientAlias: { upsert: vi.fn() },
  },
}))
vi.mock("@/lib/auth-scope", () => ({
  getAuthScope: vi.fn(async () => ({ ownerId: "owner-1", accountId: "acct-A" })),
}))
vi.mock("@/lib/ingredient-cost", () => ({
  recomputeCanonicalCost: vi.fn(async () => ({ status: "unchanged" })),
  getLineItemBaseQty: vi.fn(() => null),
}))
vi.mock("@/lib/ingredient-embedding-sync", () => ({ syncCanonicalEmbedding: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { confirmSkuMatch } from "@/app/actions/ingredient-match-actions"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.invoiceLineItem.findFirst).mockResolvedValue({
    id: "li-clicked",
    sku: "15726",
    productName: "HOUSE SAUCE BULK",
    unit: "CS",
    invoice: { vendorName: "VITCO FOODSERVICE", storeId: "store-1" },
  } as never)
  vi.mocked(prisma.ingredientSkuMatch.upsert).mockResolvedValue({} as never)
  vi.mocked(prisma.invoiceLineItem.updateMany).mockResolvedValue({ count: 0 } as never)
})

describe("confirmSkuMatch vendor identity", () => {
  it("keys the learned match on vendorMatchKey and stores the display name", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([] as never)

    await confirmSkuMatch({ lineItemId: "li-clicked", canonicalIngredientId: "canon-bulk" })

    expect(prisma.ingredientSkuMatch.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId_vendorKey_sku: {
            ownerId: "owner-1",
            vendorKey: "vitco foodservice",
            sku: "15726",
          },
        },
        create: expect.objectContaining({
          vendorName: "Vitco Foodservice",
          vendorKey: "vitco foodservice",
        }),
      })
    )
  })

  it("backfills history across every spelling of the vendor, not just the clicked one", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      { id: "li-caps", invoice: { vendorName: "VITCO FOODSERVICE" } },
      { id: "li-mixed", invoice: { vendorName: "Vitco Foodservice" } },
      { id: "li-spaced", invoice: { vendorName: "Vitco Food Service" } },
      { id: "li-other", invoice: { vendorName: "Bear State Kitchen" } },
    ] as never)
    vi.mocked(prisma.invoiceLineItem.updateMany).mockResolvedValue({ count: 3 } as never)

    const result = await confirmSkuMatch({
      lineItemId: "li-clicked",
      canonicalIngredientId: "canon-bulk",
    })

    expect(prisma.invoiceLineItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["li-caps", "li-mixed", "li-spaced"] } },
      data: expect.objectContaining({
        canonicalIngredientId: "canon-bulk",
        matchSource: "sku",
      }),
    })
    expect(result.backfilled).toBe(3)
  })

  it("does not issue an update when no history matches the vendor key", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      { id: "li-other", invoice: { vendorName: "Bear State Kitchen" } },
    ] as never)

    const result = await confirmSkuMatch({
      lineItemId: "li-clicked",
      canonicalIngredientId: "canon-bulk",
    })

    expect(prisma.invoiceLineItem.updateMany).not.toHaveBeenCalled()
    expect(result.backfilled).toBe(0)
  })
})
