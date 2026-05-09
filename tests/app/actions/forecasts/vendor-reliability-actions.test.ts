// getVendorReliability — three reliability metrics per vendor (lead-time
// CV, price volatility, monthly total CV) collapsed into a 0-100 composite.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: { findMany: vi.fn() },
    invoiceLineItem: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/vendor-normalize", () => ({
  normalizeVendorName: (name: string) => name.toLowerCase().trim(),
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getVendorReliability } from "@/app/actions/forecasts/vendor-reliability-actions"

const sessionWith = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([] as never)
})

function mkInvoice(vendorName: string, ymd: string, totalAmount: number) {
  return {
    vendorName,
    invoiceDate: new Date(`${ymd}T00:00:00Z`),
    totalAmount,
  }
}

describe("getVendorReliability", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getVendorReliability({})).toBeNull()
  })

  it("returns no_data when there are no invoices in the window", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never)
    expect(await getVendorReliability({})).toEqual({ ok: false, error: "no_data" })
  })

  it("scores a perfectly periodic vendor with stable totals as 'high'", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    // 8 invoices, exactly 7 days apart, identical totals — stable on every axis.
    const invoices = Array.from({ length: 8 }, (_, i) => {
      const d = new Date("2026-01-04T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + i * 7)
      return mkInvoice("Sysco", d.toISOString().slice(0, 10), 1000)
    })
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(invoices as never)

    const result = await getVendorReliability({
      asOf: new Date("2026-05-01T00:00:00Z"),
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.rows).toHaveLength(1)
    const r = result.data.rows[0]
    expect(r.invoiceCount).toBe(8)
    expect(r.meanLeadDays).toBeCloseTo(7, 5)
    expect(r.leadDayStd).toBeCloseTo(0, 5)
    expect(r.leadCV).toBeCloseTo(0, 5)
    expect(r.reliabilityScore).toBe(100)
    expect(r.band).toBe("high")
  })

  it("flags 'low' for an erratic vendor with high lead-time variance and price swings", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    // Invoice gaps: 2, 14, 2, 14, 2, 14, 2 → highly bimodal (high CV)
    const dates = ["2026-01-01", "2026-01-03", "2026-01-17", "2026-01-19", "2026-02-02", "2026-02-04", "2026-02-18", "2026-02-20"]
    const invoices = dates.map((d, i) => mkInvoice("Wild Vendor", d, 500 + (i % 2) * 4000))
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(invoices as never)
    // Same ingredient priced wildly differently month-over-month
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      {
        canonicalIngredientId: "ing-1",
        unitPrice: 1.0,
        invoice: { vendorName: "Wild Vendor", invoiceDate: new Date("2026-01-15T00:00:00Z") },
      },
      {
        canonicalIngredientId: "ing-1",
        unitPrice: 2.0,
        invoice: { vendorName: "Wild Vendor", invoiceDate: new Date("2026-02-15T00:00:00Z") },
      },
    ] as never)

    const result = await getVendorReliability({
      asOf: new Date("2026-05-01T00:00:00Z"),
    })
    if (!result || !result.ok) throw new Error("expected ok")
    const r = result.data.rows[0]
    expect(r.leadCV).toBeGreaterThan(0.5)
    expect(r.priceVolatility).toBeGreaterThan(0.5)
    expect(r.reliabilityScore).toBeLessThan(50)
    expect(r.band).toBe("low")
  })

  it("classifies low-volume vendors as insufficient_data", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      mkInvoice("New Vendor", "2026-04-01", 1000),
      mkInvoice("New Vendor", "2026-04-15", 1000),
    ] as never)
    const result = await getVendorReliability({
      asOf: new Date("2026-05-01T00:00:00Z"),
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.rows[0].band).toBe("insufficient_data")
  })

  it("sorts vendors by spend descending so the operator sees biggest exposure first", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      mkInvoice("Big", "2026-04-01", 5000),
      mkInvoice("Big", "2026-04-08", 5000),
      mkInvoice("Big", "2026-04-15", 5000),
      mkInvoice("Big", "2026-04-22", 5000),
      mkInvoice("Small", "2026-04-01", 200),
      mkInvoice("Small", "2026-04-08", 200),
      mkInvoice("Small", "2026-04-15", 200),
      mkInvoice("Small", "2026-04-22", 200),
    ] as never)
    const result = await getVendorReliability({
      asOf: new Date("2026-05-01T00:00:00Z"),
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.rows.map((r) => r.vendorName)).toEqual(["Big", "Small"])
  })
})
