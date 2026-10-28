// invoices adapter · the Needs you desk and the list's new fields.
//
// The desk is the worklist `reviewOf` cuts to three, drawn whole: every
// invoice that does not reconcile, then every invoice held in review, biggest
// money first. A REJECTED invoice used to fall through `isStatus` into MATCHED
// and was summed into "Matched and costed"; these pin that it no longer is.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { invoice: { findMany: vi.fn() } },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { getInvoicesSectionPromises } from "@/lib/counter/adapters/invoices"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const TODAY = new Date("2026-10-20T20:00:00.000Z")

const line = (productName: string, extendedPrice: number) => ({
  productName,
  canonicalIngredientId: "ing_1",
  canonicalIngredient: { name: "beef" },
  quantity: 1,
  unit: "CS",
  unitPrice: extendedPrice,
  extendedPrice,
})

interface Over {
  status?: string
  lines?: number[]
  subtotal?: number
  total?: number
  date?: string
  reasons?: unknown
  isReturn?: boolean
  storeId?: string | null
}

const invoice = (id: string, o: Over = {}) => {
  const lines = o.lines ?? [100]
  const total = o.total ?? lines.reduce((t, n) => t + n, 0)
  return {
    id,
    storeId: o.storeId === undefined ? "store_a" : o.storeId,
    isReturn: o.isReturn ?? false,
    invoiceNumber: `N-${id}`,
    vendorName: "Sysco",
    invoiceDate: new Date(o.date ?? "2026-10-15T00:00:00.000Z"),
    dueDate: null,
    totalAmount: total,
    subtotal: o.subtotal ?? total,
    status: o.status ?? "MATCHED",
    pdfBlobPathname: "invoices/a_-b.pdf",
    reviewReasons: o.reasons ?? null,
    lineItems: lines.map((n, i) => line(`Item ${i}`, n)),
  }
}

async function sectionsOf(rows: unknown[]) {
  asMock(prisma.invoice.findMany).mockResolvedValue(rows)
  asMock(getScopedStores).mockResolvedValue([{ id: "store_a", name: "Van Nuys" }])
  return getInvoicesSectionPromises({
    range: { start: new Date("2026-10-14T00:00:00.000Z"), end: new Date("2026-10-20T00:00:00.000Z") },
    presetId: "d7",
    storeId: null,
    accountId: "acct_ours",
    today: TODAY,
  })
}

async function ready<T>(p: Promise<{ status: string; data?: T }>): Promise<T> {
  const s = await p
  if (s.status !== "ready") throw new Error(`section was ${s.status}`)
  return (s as { data: T }).data
}

describe("invoices adapter · the Needs you desk", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("lists every open invoice, not the phone's three, biggest gap first", async () => {
    const rows = [
      invoice("small", { lines: [90], subtotal: 100 }), // $10 short
      invoice("big", { lines: [100], subtotal: 600 }), // $500 short
      invoice("mid", { lines: [100], subtotal: 150 }), // $50 short
      invoice("held", { status: "REVIEW", lines: [3000], reasons: [{ kind: "pack_shape", message: "Pack looks wrong", lineNumbers: [1] }] }),
      invoice("fine"),
    ]
    const desk = await ready((await sectionsOf(rows)).desk)
    expect(desk.items.map((i) => i.key)).toEqual(["big", "mid", "held", "small"])
    expect(desk.items[0]).toMatchObject({ glyph: "miss", gap: "$500.00 short", where: "Van Nuys · Oct 15", act: "Open and fix" })
    expect(desk.items[2]).toMatchObject({ glyph: "open", gap: null, reason: "A pack shape looks wrong (line 1)." })
    expect(desk.broken).toBe(3)
    expect(desk.brokenNet).toBe("$560.00 short")
  })

  it("lists an invoice that is short AND held in review once, under its gap", async () => {
    const rows = [invoice("both", { status: "REVIEW", lines: [80], subtotal: 100 })]
    const desk = await ready((await sectionsOf(rows)).desk)
    expect(desk.items).toHaveLength(1)
    expect(desk.items[0]).toMatchObject({ key: "both", glyph: "miss" })
  })

  it("says plainly when nothing was read from the PDF", async () => {
    const rows = [invoice("blank", { lines: [], total: 250, subtotal: 250 })]
    const desk = await ready((await sectionsOf(rows)).desk)
    expect(desk.items[0].reason).toBe("No lines were read from the PDF.")
  })
})

describe("invoices adapter · the list's status shapes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("keeps REJECTED its own status and out of Matched and costed", async () => {
    const rows = [invoice("ok", { lines: [100] }), invoice("rej", { status: "REJECTED", lines: [400] })]
    const s = await sectionsOf(rows)
    const list = await ready(s.list)
    const rej = list.rows.find((r) => r.id === "rej")!
    expect(rej.status).toBe("REJECTED")
    expect(rej.glyph).toBe("off")
    const head = await ready(s.headline)
    const costed = head.cells.find((c) => c.label === "Matched and costed")!
    expect(costed.value).toBe("$100")
  })

  it("takes a rejected invoice that does not add up off the worklist", async () => {
    const rows = [invoice("rej", { status: "REJECTED", lines: [], total: 1474.06, subtotal: 1474.06 })]
    const s = await sectionsOf(rows)
    const list = await ready(s.list)
    expect(list.rows[0]).toMatchObject({ glyph: "off", openGap: false, needsYou: false })
    expect(list.rows[0].gap).not.toBeNull()
    expect(list.gapCount).toBe(0)
    const desk = await ready(s.desk)
    expect(desk.items).toHaveLength(0)
    expect(desk.broken).toBe(0)
  })

  it("says total, not subtotal, when the invoice prints no subtotal", async () => {
    const row = { ...invoice("nosub", { lines: [80], total: 100 }), subtotal: null }
    const desk = await ready((await sectionsOf([row])).desk)
    expect(desk.items[0].reason).toBe("The lines are $20.00 short of the printed total.")
  })

  it("names the store, marks credits, and flags what needs the owner", async () => {
    const rows = [
      invoice("credit", { isReturn: true, lines: [-50] }),
      invoice("short", { lines: [80], subtotal: 100 }),
      invoice("nostore", { storeId: null }),
    ]
    const list = await ready((await sectionsOf(rows)).list)
    const by = Object.fromEntries(list.rows.map((r) => [r.id, r]))
    expect(by.credit).toMatchObject({ store: "Van Nuys", isReturn: true, glyph: "up", needsYou: false })
    expect(by.short).toMatchObject({ glyph: "miss", needsYou: true })
    expect(by.nostore.store).toBeNull()
  })

  it("carries an old invoice still held in review, hidden from the 30-day view", async () => {
    const rows = [invoice("old", { status: "REVIEW", date: "2026-06-01T00:00:00.000Z" })]
    const list = await ready((await sectionsOf(rows)).list)
    expect(list.rows).toHaveLength(1)
    expect(list.rows[0]).toMatchObject({ inWindow: false, needsYou: true, glyph: "open" })
    expect(list.gapOutsideWindow).toBe(0)
  })
})

describe("invoices adapter · tie-out in whole cents", () => {
  it("counts a two-cent gap that float subtraction reads as 0.01999", async () => {
    const rows = [invoice("two", { lines: [100.02], subtotal: 100, total: 100 })]
    const list = await ready((await sectionsOf(rows)).list)
    expect(list.rows[0].gap).toBe("$0.02 over")
  })
})
