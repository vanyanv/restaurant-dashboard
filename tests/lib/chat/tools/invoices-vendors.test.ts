/*
 * The chat's vendor rollups, and whether they name the same supplier the rest
 * of the product does.
 *
 * `Invoice.vendorName` is whatever the invoice was printed with. Every other
 * vendor surface folds it through `normalizeVendorName` first — that helper
 * exists because "Vitco Foodservice" and "VITCO FOOD SERVICE" arrive from two
 * invoice templates and plotted as two bars on the spend-by-vendor chart.
 *
 * These two tools grouped on the raw string. Asked "who's our biggest
 * vendor?", the answer split the real leader across its own spellings and
 * named the runner-up — and `share` was computed off those split amounts, so
 * the concentration of spend read lower than it is.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/chat/owner-scope", () => ({
  assertOwnerOwnsStores: vi.fn(async () => ["s1"]),
}))

import { getInvoiceSpend, sumInvoiceLines } from "@/lib/chat/tools/invoices"
import type { ChatToolContext } from "@/lib/chat/tools/types"

const dateRange = { from: "2026-08-01", to: "2026-08-31" }

function invoice(vendorName: string, totalAmount: number) {
  return { vendorName, totalAmount, invoiceDate: new Date("2026-08-10T00:00:00.000Z") }
}

function spendCtx(rows: ReturnType<typeof invoice>[]): ChatToolContext {
  return {
    ownerId: "u1",
    accountId: "acct-A",
    prisma: {
      invoice: { findMany: vi.fn(async () => rows) },
    } as unknown as ChatToolContext["prisma"],
  }
}

describe("getInvoiceSpend — one supplier, one row", () => {
  it("folds a vendor's spellings together instead of splitting its spend", async () => {
    const r = await getInvoiceSpend.execute(
      { dateRange },
      spendCtx([
        invoice("SYSCO LOS ANGELES", 6_000),
        invoice("Sysco Los Angeles", 5_000),
        invoice("Restaurant Depot", 8_000),
      ]),
    )

    // Unfolded, this answered "Restaurant Depot" at $8,000. Sysco is $11,000.
    expect(r.byVendor[0].vendor).toBe("Sysco")
    expect(r.byVendor[0].amount).toBe(11_000)
    expect(r.byVendor[0].invoiceCount).toBe(2)
    expect(r.byVendor).toHaveLength(2)
  })

  it("computes share off the folded amount, so concentration reads true", async () => {
    const r = await getInvoiceSpend.execute(
      { dateRange },
      spendCtx([
        invoice("VITCO FOOD SERVICE", 2_500),
        invoice("Vitco Foodservice", 2_500),
      ]),
    )
    expect(r.byVendor).toHaveLength(1)
    expect(r.byVendor[0].vendor).toBe("Vitco Foodservice")
    expect(r.byVendor[0].share).toBe(1)
  })

  it("leaves a vendor with no alias exactly as the invoice spelled it", async () => {
    const r = await getInvoiceSpend.execute(
      { dateRange },
      spendCtx([invoice("Bear State Kitchen", 3_398)]),
    )
    expect(r.byVendor[0].vendor).toBe("Bear State Kitchen")
  })
})

describe("sumInvoiceLines — the same fold", () => {
  it("rolls a vendor's line items up under one name", async () => {
    const lines = [
      { id: "l1", extendedPrice: 400, invoice: { vendorName: "SYSCO CORP", invoiceDate: new Date("2026-08-10T00:00:00.000Z") } },
      { id: "l2", extendedPrice: 600, invoice: { vendorName: "Sysco Los Angeles", invoiceDate: new Date("2026-08-11T00:00:00.000Z") } },
    ]
    const ctx = {
      ownerId: "u1",
      accountId: "acct-A",
      prisma: {
        invoiceLineItem: { findMany: vi.fn(async () => lines) },
      } as unknown as ChatToolContext["prisma"],
    }

    const r = await sumInvoiceLines.execute({ lineIds: ["l1", "l2"] }, ctx)
    expect(r.byVendor).toHaveLength(1)
    expect(r.byVendor[0]).toMatchObject({ vendor: "Sysco", amount: 1_000, lineCount: 2 })
  })
})
