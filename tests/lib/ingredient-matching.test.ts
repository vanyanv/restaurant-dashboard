import { describe, it, expect, vi, beforeEach } from "vitest"

const db = vi.hoisted(() => ({
  invoice: { findMany: vi.fn() },
  ingredientSkuMatch: { findMany: vi.fn() },
  ingredientAlias: { findMany: vi.fn() },
  invoiceLineItem: { groupBy: vi.fn(), update: vi.fn() },
  $executeRaw: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({ prisma: db }))
vi.mock("@/lib/ingredient-cost", () => ({
  recomputeCanonicalCost: vi.fn().mockResolvedValue({ status: "unchanged", reason: "same-value" }),
}))

import { Prisma } from "@/generated/prisma/client"
import { matchNewLineItems, productNameKey } from "@/lib/ingredient-matching"

/** The bound values of the n-th bulk UPDATE, flattened. */
function rawValues(n = 0): unknown[] {
  const [strings, ...vals] = db.$executeRaw.mock.calls[n] as [TemplateStringsArray, ...unknown[]]
  return Prisma.sql(strings, ...(vals as Prisma.Sql[])).values
}

function invoiceWith(lines: Array<{ id: string; sku: string | null; productName: string; unit?: string | null }>) {
  return [
    {
      id: "inv_1",
      vendorName: "Brand New Vendor",
      storeId: "store_1",
      lineItems: lines.map((l) => ({ unit: "CS", ...l })),
    },
  ]
}

describe("matchNewLineItems name fallback", () => {
  beforeEach(() => {
    for (const m of [db.invoice.findMany, db.ingredientSkuMatch.findMany, db.ingredientAlias.findMany, db.invoiceLineItem.groupBy, db.invoiceLineItem.update, db.$executeRaw]) m.mockReset()
    db.$executeRaw.mockResolvedValue(1)
    db.ingredientSkuMatch.findMany.mockResolvedValue([])
    db.ingredientAlias.findMany.mockResolvedValue([])
  })

  it("links a new vendor's line to the one ingredient that name has always meant", async () => {
    db.invoice.findMany.mockResolvedValue(
      invoiceWith([{ id: "li_1", sku: "99581COKEZERO", productName: "Syrup Coca Cola Zero Sugar" }])
    )
    db.invoiceLineItem.groupBy.mockResolvedValue([
      { productName: "SYRUP COCA COLA ZERO SUGAR", canonicalIngredientId: "ci_zero", unit: "CS" },
      { productName: "Syrup Coca-Cola Zero Sugar", canonicalIngredientId: "ci_zero", unit: "cs" },
    ])
    const res = await matchNewLineItems("acc_1", ["inv_1"])
    expect(res.matchedByName).toBe(1)
    expect(db.$executeRaw).toHaveBeenCalledTimes(1)
    expect(rawValues().slice(1, 4)).toEqual(["li_1", "ci_zero", "name"])
    expect(db.invoiceLineItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          invoice: { accountId: "acc_1" },
          // Only SKU and hand matches count as evidence, never an earlier guess.
          matchSource: { in: ["sku", "manual"] },
          productName: { in: ["Syrup Coca Cola Zero Sugar"], mode: "insensitive" },
        }),
      })
    )
  })

  it("leaves a line billed in a different unit for review", async () => {
    db.invoice.findMany.mockResolvedValue(
      invoiceWith([{ id: "li_1", sku: null, productName: "Ground Beef", unit: "LB" }])
    )
    db.invoiceLineItem.groupBy.mockResolvedValue([
      { productName: "Ground Beef", canonicalIngredientId: "ci_beef", unit: "CS" },
    ])
    const res = await matchNewLineItems("acc_1", ["inv_1"])
    expect(res).toMatchObject({ matchedByName: 0, unmatched: 1 })
  })

  it("leaves a name that two ingredients have shared for review", async () => {
    db.invoice.findMany.mockResolvedValue(invoiceWith([{ id: "li_1", sku: null, productName: "Fries" }]))
    db.invoiceLineItem.groupBy.mockResolvedValue([
      { productName: "Fries", canonicalIngredientId: "ci_fry", unit: "CS" },
      { productName: "FRIES", canonicalIngredientId: "ci_tray", unit: "CS" },
    ])
    const res = await matchNewLineItems("acc_1", ["inv_1"])
    expect(res).toMatchObject({ matchedByName: 0, unmatched: 1 })
    expect(db.invoiceLineItem.update).not.toHaveBeenCalled()
    expect(db.$executeRaw).not.toHaveBeenCalled()
  })

  it("still prefers a learned SKU match", async () => {
    db.invoice.findMany.mockResolvedValue(invoiceWith([{ id: "li_1", sku: "G299", productName: "Peppers Whole Yellow" }]))
    db.ingredientSkuMatch.findMany.mockResolvedValue([
      { vendorKey: "brand new vendor", sku: "G299", canonicalIngredientId: "ci_pepper" },
    ])
    db.invoiceLineItem.groupBy.mockResolvedValue([{ productName: "Peppers Whole Yellow", canonicalIngredientId: "ci_other" }])
    const res = await matchNewLineItems("acc_1", ["inv_1"])
    expect(res).toMatchObject({ matchedBySku: 1, matchedByName: 0 })
  })
})

describe("matchNewLineItems bulk write", () => {
  beforeEach(() => {
    for (const m of [db.invoice.findMany, db.ingredientSkuMatch.findMany, db.ingredientAlias.findMany, db.invoiceLineItem.groupBy, db.invoiceLineItem.update, db.$executeRaw]) m.mockReset()
    db.ingredientAlias.findMany.mockResolvedValue([])
    db.invoiceLineItem.groupBy.mockResolvedValue([])
    db.$executeRaw.mockResolvedValue(3)
  })

  it("links every matched line in one statement, not one UPDATE per line", async () => {
    db.invoice.findMany.mockResolvedValue(
      invoiceWith([
        { id: "li_1", sku: "A1", productName: "Buns" },
        { id: "li_2", sku: "B2", productName: "Beef" },
        { id: "li_3", sku: "C3", productName: "Cheese" },
        { id: "li_4", sku: "ZZ", productName: "Mystery" },
      ])
    )
    db.ingredientSkuMatch.findMany.mockResolvedValue([
      { vendorKey: "brand new vendor", sku: "A1", canonicalIngredientId: "ci_bun" },
      { vendorKey: "brand new vendor", sku: "B2", canonicalIngredientId: "ci_beef" },
      { vendorKey: "brand new vendor", sku: "C3", canonicalIngredientId: "ci_cheese" },
    ])
    const res = await matchNewLineItems("acc_1", ["inv_1"])
    expect(res).toMatchObject({ matchedBySku: 3, unmatched: 1 })
    expect(db.invoiceLineItem.update).not.toHaveBeenCalled()
    expect(db.$executeRaw).toHaveBeenCalledTimes(1)
    const values = rawValues()
    expect(values[0]).toBeInstanceOf(Date)
    expect(values.slice(1)).toEqual([
      "li_1", "ci_bun", "sku",
      "li_2", "ci_beef", "sku",
      "li_3", "ci_cheese", "sku",
    ])
    // Only still-unmatched lines are written: a hand match made meanwhile stands.
    const sqlText = (db.$executeRaw.mock.calls[0][0] as TemplateStringsArray).join("?")
    expect(sqlText).toContain(`"canonicalIngredientId" IS NULL`)
  })
})

describe("productNameKey", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(productNameKey("  Syrup Coca-Cola  Zero ")).toBe("syrup coca cola zero")
  })
})
