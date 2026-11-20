// Toggling an invoice between purchase and return rewrites every line's sign.
// It was one UPDATE per line inside the transaction; now it is one statement
// for all lines, with the same abs-times-sign rule as the header.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth-scope", () => ({ getSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ hasOwnerAccess: () => true }))
vi.mock("@/lib/cache/cached", () => ({ bustTags: vi.fn(), cached: (f: unknown) => f, stableKey: () => "" }))
vi.mock("@/lib/ingredient-cost", () => ({ recomputeCanonicalCost: vi.fn(async () => ({ status: "unchanged" })) }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: { findFirst: vi.fn(), update: vi.fn((a: unknown) => ({ op: "invoice.update", a })) },
    invoiceLineItem: { update: vi.fn() },
    $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: "raw", strings, values })),
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}))

import { getSession } from "@/lib/auth-scope"
import { prisma } from "@/lib/prisma"
import { setInvoiceIsReturn } from "@/app/actions/invoice-actions"

const m = (f: unknown) => f as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  m(getSession).mockResolvedValue({ user: { accountId: "acct_A", role: "OWNER" } })
  m(prisma.invoice.findFirst).mockResolvedValue({
    id: "inv_1",
    isReturn: false,
    totalAmount: 100,
    subtotal: 90,
    taxAmount: 10,
    lineItems: Array.from({ length: 40 }, (_, i) => ({ canonicalIngredientId: i % 2 ? "ci_1" : null })),
  })
})

describe("setInvoiceIsReturn", () => {
  it("flips every line in one statement, scoped to the invoice", async () => {
    expect(await setInvoiceIsReturn("inv_1", true)).toEqual({ ok: true })
    expect(prisma.invoiceLineItem.update).not.toHaveBeenCalled()
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    const [strings, ...values] = m(prisma.$executeRaw).mock.calls[0]
    expect((strings as string[]).join("?")).toMatch(/ABS\("quantity"\).*ABS\("extendedPrice"\).*"invoiceId"/s)
    expect(values).toEqual([-1, -1, "inv_1"])
    const ops = m(prisma.$transaction).mock.calls[0][0] as Array<{ op: string }>
    expect(ops.map((o) => o.op)).toEqual(["invoice.update", "raw"])
    expect(m(prisma.invoice.findFirst).mock.calls[0][0].where).toEqual({ id: "inv_1", accountId: "acct_A" })
  })

  it("writes nothing when the flag already matches", async () => {
    await setInvoiceIsReturn("inv_1", false)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
