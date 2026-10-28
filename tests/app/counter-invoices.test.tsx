// @vitest-environment jsdom
/**
 * The Invoices tabs and the invoice page, rendered from what their adapters
 * actually return (Prisma mocked), so a field the client reads and the
 * adapter does not write fails here rather than on the owner's screen.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/dashboard/invoices",
  useSearchParams: () => new URLSearchParams(""),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: { invoice: { findMany: vi.fn(), findFirst: vi.fn() } },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))
vi.mock("@/lib/counter/actions/invoice", () => ({
  markInvoiceReturn: vi.fn(),
  resolveInvoiceReview: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { getInvoicesSectionPromises } from "@/lib/counter/adapters/invoices"
import { getInvoiceSectionPromises } from "@/lib/counter/adapters/invoice"
import { ready } from "@/lib/counter/section-data"
import { CounterInvoicesClient } from "@/app/dashboard/(counter)/invoices/counter-invoices-client"
import { AllInvoicesClient } from "@/app/dashboard/(counter)/invoices/all/all-invoices-client"
import { CounterInvoiceClient } from "@/app/dashboard/(counter)/invoices/[id]/counter-invoice-client"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const TODAY = new Date("2026-10-20T20:00:00.000Z")

const listLine = (n: number) => ({
  productName: "Beef",
  canonicalIngredientId: "ing_1",
  canonicalIngredient: { name: "ground beef" },
  quantity: 1,
  unit: "CS",
  unitPrice: n,
  extendedPrice: n,
})

const inv = (id: string, status: string, lines: number[], subtotal: number) => ({
  id,
  storeId: "store_a",
  isReturn: false,
  invoiceNumber: `N-${id}`,
  vendorName: "Sysco",
  invoiceDate: new Date("2026-10-15T00:00:00.000Z"),
  dueDate: null,
  totalAmount: subtotal,
  subtotal,
  status,
  pdfBlobPathname: "invoices/a_-b.pdf",
  reviewReasons: null,
  lineItems: lines.map(listLine),
})

async function resolved<T extends Record<string, Promise<unknown>>>(s: T) {
  const out = {} as { [K in keyof T]: Awaited<T[K]> }
  for (const k of Object.keys(s) as Array<keyof T>) out[k] = (await s[k]) as Awaited<T[typeof k]>
  return out
}

async function invoicesSections() {
  asMock(prisma.invoice.findMany).mockResolvedValue([
    inv("short", "MATCHED", [100], 312.4),
    inv("held", "REVIEW", [500], 500),
    inv("fine", "APPROVED", [200], 200),
    inv("rej", "REJECTED", [90], 90),
  ])
  asMock(getScopedStores).mockResolvedValue([{ id: "store_a", name: "Van Nuys" }])
  return resolved(
    getInvoicesSectionPromises({
      range: { start: new Date("2026-10-14T00:00:00.000Z"), end: new Date("2026-10-20T00:00:00.000Z") },
      presetId: "d7",
      storeId: null,
      accountId: "acct_ours",
      today: TODAY,
    }),
  )
}

const moverRows = [
  {
    key: "ing_1",
    href: "/dashboard/ingredients/ing_1",
    cells: { ingredient: "ground beef", median: "$3.84", latest: "$4.18", move: "+9%", volume: "910 lb", costs: "$264", recipes: "5" },
  },
]

const movers = ready({
  rows: moverRows,
  allRows: moverRows,
  phoneRows: [],
  meta: "1 of 1",
  note: "Ranked by money.",
})

describe("Invoices · Needs you", () => {
  beforeEach(() => vi.clearAllMocks())

  it("draws the tiles, the alert and every open invoice with its next step", async () => {
    const s = await invoicesSections()
    render(<CounterInvoicesClient sub="All stores" sections={{ headline: s.headline, desk: s.desk }} prices={{ movers }} />)
    expect(screen.getByText("Matched and costed")).toBeTruthy()
    expect(screen.getByText(/1 invoice does not add up/)).toBeTruthy()
    const short = screen.getByText("The lines are $212.40 short of the printed subtotal.")
    expect(short).toBeTruthy()
    const fix = screen.getByRole("link", { name: "Open and fix" })
    expect(fix.getAttribute("href")).toBe("/dashboard/invoices/short")
    expect(screen.getByRole("link", { name: "Check it" }).getAttribute("href")).toBe("/dashboard/invoices/held")
    expect(screen.getByRole("link", { name: "Every price that moved" }).getAttribute("href")).toBe("/dashboard/invoices/prices")
  })
})

describe("Invoices · All invoices", () => {
  beforeEach(() => vi.clearAllMocks())

  it("opens on the view a tile asked for, and switches views from the chips", async () => {
    const s = await invoicesSections()
    render(
      <AllInvoicesClient
        params=""
        stores={[{ id: "store_a", name: "Van Nuys", stage: "trading" }]}
        today={TODAY}
        initialView="gaps"
        sections={{ list: s.list, spend: s.spend, products: s.products, documents: s.documents }}
      />,
    )
    expect(screen.getByText("1 shown")).toBeTruthy()
    expect(screen.getByText("N-short")).toBeTruthy()
    expect(screen.queryByText("N-fine")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /^All/ }))
    expect(screen.getByText("4 shown")).toBeTruthy()
    expect(screen.getByText("N-rej")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /^Rejected/ }))
    expect(screen.getByText("1 shown")).toBeTruthy()
    expect(within(screen.getByText("N-rej").closest("tr")!).getByRole("img", { name: "Rejected" })).toBeTruthy()
  })
})

describe("Invoices · one invoice", () => {
  beforeEach(() => vi.clearAllMocks())

  it("locks approve while the lines do not tie out, and says why", async () => {
    asMock(prisma.invoice.findFirst).mockResolvedValue({
      id: "inv_1",
      invoiceNumber: "448812",
      vendorName: "Sysco",
      invoiceDate: new Date("2026-10-21T00:00:00Z"),
      dueDate: null,
      status: "REVIEW",
      totalAmount: 312.4,
      subtotal: 312.4,
      taxAmount: 0,
      isReturn: false,
      reviewReasons: null,
      matchConfidence: 0.98,
      emailSubject: "Invoice 448812",
      emailReceivedAt: new Date("2026-10-23T10:00:00Z"),
      attachmentName: "448812.pdf",
      pdfBlobPathname: "invoices/abc_-def.pdf",
      pdfSize: 300_000,
      extractionModel: "gemini",
      rawExtractionJson: null,
      store: { name: "Van Nuys" },
      lineItems: [
        {
          lineNumber: 1,
          sku: null,
          productName: "Beef",
          quantity: 1,
          unit: "CS",
          unitPrice: 100,
          extendedPrice: 100,
          packSize: null,
          unitSize: null,
          unitSizeUom: null,
          matchSource: "sku",
          canonicalIngredient: { name: "ground beef" },
        },
      ],
    })
    const s = await resolved(getInvoiceSectionPromises({ invoiceId: "inv_1", accountId: "acct_ours" }))
    render(<CounterInvoiceClient stores={[]} title="448812" vendor="Sysco" sections={s} />)
    const approve = screen.getByRole("button", { name: "Approve and post" }) as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    expect(screen.getByText(/Approve unlocks when the gap is zero/)).toBeTruthy()
    expect(screen.getByText("The lines are $212.40 short")).toBeTruthy()
    expect(screen.getByText("Does not add up")).toBeTruthy()
  })
})
