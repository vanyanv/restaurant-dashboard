/**
 * `setInvoiceStore` — the one-tap "Yes, Glendale" on Invoices → This week.
 * It may only answer the store question: same account, REVIEW, held for the
 * store alone, and tying out. Anything else is refused and nothing is written.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: () => true }))
vi.mock("@/lib/cache/cached", () => ({ bustTags: vi.fn(), cached: (f: unknown) => f, stableKey: () => "" }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: { findFirst: vi.fn(), updateMany: vi.fn() },
    store: { findFirst: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { setInvoiceStore } from "@/app/actions/invoice-actions"

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const held = (over: Record<string, unknown> = {}) => ({
  id: "inv_1",
  status: "REVIEW",
  reviewReasons: [{ kind: "low_match_confidence", message: "75%" }],
  subtotal: 100,
  taxAmount: 0,
  totalAmount: 100,
  lineItems: [{ productName: "Beef", sku: "1", extendedPrice: 100 }],
  ...over,
})

describe("setInvoiceStore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m(getServerSession).mockResolvedValue({ user: { accountId: "acct_ours", role: "OWNER" } })
    m(prisma.store.findFirst).mockResolvedValue({ id: "store_g" })
    m(prisma.invoice.updateMany).mockResolvedValue({ count: 1 })
  })

  it("moves and approves a store-only hold, scoped to the account and to REVIEW", async () => {
    m(prisma.invoice.findFirst).mockResolvedValue(held())
    expect(await setInvoiceStore("inv_1", "store_g")).toEqual({ ok: true, storeId: "store_g" })
    expect(m(prisma.invoice.findFirst).mock.calls[0][0].where).toEqual({ id: "inv_1", accountId: "acct_ours" })
    expect(m(prisma.store.findFirst).mock.calls[0][0].where).toEqual({ id: "store_g", accountId: "acct_ours" })
    const write = m(prisma.invoice.updateMany).mock.calls[0][0]
    expect(write.where).toEqual({ id: "inv_1", accountId: "acct_ours", status: "REVIEW" })
    expect(write.data).toMatchObject({ storeId: "store_g", status: "APPROVED" })
  })

  it("refuses another account's store, other holds, a gap, and a lost race", async () => {
    m(prisma.store.findFirst).mockResolvedValueOnce(null)
    m(prisma.invoice.findFirst).mockResolvedValue(held())
    expect(await setInvoiceStore("inv_1", "store_x")).toEqual({ ok: false, reason: "store-not-found" })

    m(prisma.invoice.findFirst).mockResolvedValue(
      held({ reviewReasons: [{ kind: "low_match_confidence" }, { kind: "pack_shape" }] }),
    )
    expect(await setInvoiceStore("inv_1", "store_g")).toEqual({ ok: false, reason: "not-store-only" })

    m(prisma.invoice.findFirst).mockResolvedValue(held({ subtotal: 300, totalAmount: 300 }))
    expect(await setInvoiceStore("inv_1", "store_g")).toEqual({ ok: false, reason: "does-not-tie-out" })

    m(prisma.invoice.findFirst).mockResolvedValue(held({ status: "MATCHED" }))
    expect(await setInvoiceStore("inv_1", "store_g")).toEqual({ ok: false, reason: "not-in-review" })
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled()

    m(prisma.invoice.findFirst).mockResolvedValue(held())
    m(prisma.invoice.updateMany).mockResolvedValueOnce({ count: 0 })
    expect(await setInvoiceStore("inv_1", "store_g")).toEqual({ ok: false, reason: "not-in-review" })
  })
})
