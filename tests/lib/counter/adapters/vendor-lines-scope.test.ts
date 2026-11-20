// The vendor page reads invoice LINES for this vendor's invoices only.
//
// It used to nest `lineItems` under every invoice in the range, for every
// vendor on the account, to print one vendor. The figures it prints — line
// counts, the tie-out gap, spend and the share of total — must not move, so
// each is recomputed here the way the old nested read fed them.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: { findMany: vi.fn(), groupBy: vi.fn() },
    invoiceLineItem: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))
vi.mock("@/lib/counter/vendor-basket", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/counter/vendor-basket")>()),
  getVendorBasketTrends: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { getVendorBasketTrends } from "@/lib/counter/vendor-basket"
import { getVendorSectionPromises } from "@/lib/counter/adapters/vendor"
import { hasData } from "@/lib/counter/section-data"
import { tieOut } from "@/lib/invoice-charges"

const RANGE = { start: new Date("2026-01-01"), end: new Date("2026-01-31") }

type Line = { productName: string; sku: string | null; extendedPrice: number }
const inv = (id: string, vendorName: string, day: number, total: number, subtotal: number) => ({
  id,
  invoiceNumber: id,
  vendorName,
  invoiceDate: new Date(Date.UTC(2026, 0, day)),
  totalAmount: total,
  subtotal,
  taxAmount: null,
  status: "MATCHED",
  pdfBlobPathname: null,
})
const lines: Record<string, Line[]> = {
  a1: [
    { productName: "Beef", sku: "B", extendedPrice: 600 },
    { productName: "Cheese", sku: "C", extendedPrice: 400 },
  ],
  a2: [{ productName: "Beef", sku: "B", extendedPrice: 300 }], // 300 against a 500 subtotal: a gap
  b1: [{ productName: "Buns", sku: "U", extendedPrice: 250 }],
  b2: [{ productName: "Buns", sku: "U", extendedPrice: 250 }],
}
const invoices = [
  inv("a1", "Sysco", 20, 1000, 1000),
  inv("b1", "Premier Meats", 18, 250, 250),
  inv("a2", "SYSCO", 10, 500, 500),
  inv("b2", "Premier Meats", 5, 250, 250),
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getScopedStores).mockResolvedValue([{ id: "s1", name: "Hollywood" }] as never)
  vi.mocked(getVendorBasketTrends).mockResolvedValue({ trend: new Map() } as never)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
  vi.mocked(prisma.invoice.findMany).mockResolvedValue(invoices as never)
  vi.mocked(prisma.invoiceLineItem.findMany).mockImplementation((async (args: {
    where: { invoiceId: { in: string[] } }
  }) =>
    args.where.invoiceId.in.flatMap((id) => (lines[id] ?? []).map((l) => ({ invoiceId: id, ...l })))) as never)
})

async function run() {
  return getVendorSectionPromises({
    vendor: "Sysco",
    accountId: "acct_1",
    storeId: null,
    range: RANGE,
    today: new Date("2026-01-31T00:00:00Z"),
  })
}

describe("vendor page — lines for this vendor only", () => {
  it("reads invoices without nested lines, and lines for this vendor's invoices under the account", async () => {
    const s = await run()
    await s.invoices
    const invoiceSelect = vi.mocked(prisma.invoice.findMany).mock.calls[0][0]?.select as Record<string, unknown>
    expect(invoiceSelect).not.toHaveProperty("lineItems")
    expect(prisma.invoiceLineItem.findMany).toHaveBeenCalledTimes(1)
    const where = vi.mocked(prisma.invoiceLineItem.findMany).mock.calls[0][0]?.where as {
      invoiceId: { in: string[] }
      invoice: { accountId: string }
    }
    expect([...where.invoiceId.in].sort()).toEqual(["a1", "a2"])
    expect(where.invoice).toEqual({ accountId: "acct_1" })
  })

  it("prints the same line counts, gaps, spend and share the nested read did", async () => {
    const s = await run()
    const sd = await s.invoices
    if (!hasData(sd)) throw new Error("invoices")
    const head = await s.head
    if (!hasData(head)) throw new Error("head")

    // Reference: exactly what the old nested read fed into the same rules.
    const mine = invoices.filter((i) => i.vendorName.toLowerCase() === "sysco")
    const expectedRows = mine.map((i) => {
      const tie = tieOut(lines[i.id], { subtotal: i.subtotal, taxAmount: i.taxAmount, totalAmount: i.totalAmount })
      return { n: lines[i.id].length, gap: tie.reconciles ? null : tie.gap }
    })
    expect(expectedRows.map((r) => r.n)).toEqual([2, 1])
    expect(expectedRows[1].gap).not.toBeNull()

    // Spend 1,500 of 2,000 = 75%: the denominator still counts every vendor.
    expect(head.data.cells[0]).toMatchObject({ value: "$1,500", delta: "75.0% of the total" })
    // Line counts and the tie-out gap come from this vendor's lines.
    expect(sd.data.rows.map((r) => r.cells.lines)).toEqual(expectedRows.map((r) => String(r.n)))
    expect(sd.data.rows[0].cells.reconciles).toBe("✓")
    expect(sd.data.rows[1].cells.reconciles).toMatchObject({ v: "−$200.00" })
    expect(head.data.cells[3]).toMatchObject({ value: "1" })
  })
})
