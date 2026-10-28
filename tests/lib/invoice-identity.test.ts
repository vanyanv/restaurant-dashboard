import { describe, it, expect, vi, beforeEach } from "vitest"

const findMany = vi.fn()
vi.mock("@/lib/prisma", () => ({ prisma: { invoice: { findMany: (...a: unknown[]) => findMany(...a) } } }))

import { invoiceIdentityKey, loadInvoiceIdentities } from "@/lib/invoice-identity"

describe("invoiceIdentityKey", () => {
  const bill = {
    vendorName: "KEVIDKO",
    invoiceNumber: "378460",
    totalAmount: 299.43,
    isReturn: false,
    storeId: "store_vn",
    invoiceDate: new Date("2026-10-12T00:00:00Z"),
  }

  it("is the same for the bill and its payment-receipt copy", () => {
    expect(invoiceIdentityKey(bill)).toBe(invoiceIdentityKey({ ...bill, vendorName: "Kevidko" }))
  })

  it("folds vendor spellings the way SKU matching does", () => {
    const a = invoiceIdentityKey({ ...bill, vendorName: "Sysco" })
    expect(a).toBe(invoiceIdentityKey({ ...bill, vendorName: "Sysco Los Angeles, Inc." }))
  })

  it("keeps a credit memo that reuses the bill's number apart", () => {
    expect(invoiceIdentityKey({ ...bill, totalAmount: -40 })).not.toBe(invoiceIdentityKey(bill))
    expect(invoiceIdentityKey({ ...bill, isReturn: true })).not.toBe(invoiceIdentityKey(bill))
  })

  it("keeps the same number and total at another store or on another day apart", () => {
    expect(invoiceIdentityKey({ ...bill, storeId: "store_gl" })).not.toBe(invoiceIdentityKey(bill))
    expect(invoiceIdentityKey({ ...bill, invoiceDate: new Date("2026-10-19T00:00:00Z") })).not.toBe(
      invoiceIdentityKey(bill)
    )
  })

  it("has nothing to go on without a real invoice number", () => {
    expect(invoiceIdentityKey({ ...bill, invoiceNumber: "  " })).toBeNull()
    expect(invoiceIdentityKey({ ...bill, invoiceNumber: null })).toBeNull()
    expect(invoiceIdentityKey({ ...bill, invoiceNumber: "001" })).toBeNull()
    expect(invoiceIdentityKey({ ...bill, invoiceNumber: "unknown" })).toBeNull()
  })
})

describe("loadInvoiceIdentities", () => {
  beforeEach(() => findMany.mockReset())

  it("reads only this account's invoices with those numbers", async () => {
    const stored = {
      vendorName: "KEVIDKO",
      invoiceNumber: "378460",
      totalAmount: 299.43,
      isReturn: false,
      storeId: "store_vn",
      invoiceDate: new Date("2026-10-12T00:00:00Z"),
    }
    findMany.mockResolvedValue([stored])
    const keys = await loadInvoiceIdentities("acc_1", ["378460", "378460", null, ""])
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: "acc_1", invoiceNumber: { in: ["378460"] } } })
    )
    expect(keys.has(invoiceIdentityKey({ ...stored, vendorName: "kevidko" })!)).toBe(true)
  })

  it("skips the query when no invoice has a number", async () => {
    expect((await loadInvoiceIdentities("acc_1", [null])).size).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })
})
