// POST /api/invoices/sync (2026-11-20 audit):
//  - every PDF in an email is read and stored as its own row, keyed by
//    (emailMessageId, emailAttachmentIndex); a statement first no longer hides
//    the bill after it, and a PDF already stored is not read again;
//  - recent invoices whose ingredient matching never finished are retried;
//  - the mailbox's account is resolved once, and an owner of any other
//    account is refused.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const db = vi.hoisted(() => ({
  jobRun: { findFirst: vi.fn(), update: vi.fn() },
  invoice: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  store: { findMany: vi.fn() },
  invoiceLineItem: { findMany: vi.fn() },
}))
const graph = vi.hoisted(() => ({
  fetchInvoiceEmails: vi.fn(),
  getEmailAttachments: vi.fn(),
  countEmailPdfAttachments: vi.fn(),
}))
const extract = vi.hoisted(() => vi.fn())
const matchNew = vi.hoisted(() => vi.fn())
const session = vi.hoisted(() => vi.fn())
const mailbox = vi.hoisted(() => vi.fn())
const cron = vi.hoisted(() => ({ isCron: false }))

vi.mock("@/lib/prisma", () => ({ prisma: db }))
vi.mock("@/lib/microsoft-graph", () => graph)
vi.mock("@/lib/gemini-invoice", () => ({ extractInvoiceData: extract }))
vi.mock("@/lib/ingredient-matching", () => ({ matchNewLineItems: matchNew }))
vi.mock("@/lib/ingredient-auto-match", () => ({ autoResolveUnmatchedLines: vi.fn() }))
vi.mock("@/lib/invoice-mailbox", () => ({ resolveInvoiceMailbox: mailbox }))
vi.mock("next-auth", () => ({ getServerSession: session }))
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: () => true }))
vi.mock("@/lib/rate-limit", () => ({
  isCronRequest: () => cron.isCron,
  rateLimit: vi.fn(async () => null),
  RATE_LIMIT_TIERS: { strict: {} },
}))
vi.mock("@/lib/invoice-pack-prior-load", () => ({ loadPackShapePriors: vi.fn(async () => new Map()) }))
vi.mock("@/lib/invoice-identity", () => ({
  invoiceIdentityKey: (inv: { invoiceNumber: string }) => inv.invoiceNumber || null,
  loadInvoiceIdentities: vi.fn(async () => new Set<string>()),
}))
vi.mock("@/lib/blob", () => ({ putInvoicePdf: vi.fn(async () => ({ pathname: "p", url: "u", size: 1, uploadedAt: new Date() })) }))
vi.mock("@/lib/graph-mail", () => ({ sendGraphMail: vi.fn(async () => ({ sent: true })) }))
vi.mock("@/lib/cache/cached", () => ({ bustTags: vi.fn() }))
vi.mock("@/lib/monitoring/job-run", () => ({
  recentSuccessSkip: () => async () => null,
  withJobRun: async (_n: string, _o: unknown, fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ jobRunId: "jr_1", addRows: () => {} }),
}))
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { POST } from "@/app/api/invoices/sync/route"

const now = new Date().toISOString()
const msg = (id: string, subject = "Invoice") => ({ id, subject, receivedDateTime: now, from: null, hasAttachments: true })
const pdf = (name: string) => ({ id: name, name, contentType: "application/pdf", contentBytes: Buffer.from(name).toString("base64"), size: 10 })
const bill = (invoiceNumber: string) => ({
  vendorName: "Sysco",
  invoiceNumber,
  invoiceDate: now.slice(0, 10),
  dueDate: null,
  deliveryAddress: "1 Main St",
  lineItems: [
    { lineNumber: 1, sku: "1", productName: "Buns", description: null, category: "Bakery", quantity: 1, unit: "CS", packSize: null, unitSize: null, unitSizeUom: null, unitPrice: 20, extendedPrice: 20 },
  ],
  subtotal: 20,
  taxAmount: 0,
  totalAmount: 20,
  isReturn: false,
})

const post = () =>
  POST(new NextRequest("https://app.example/api/invoices/sync", { method: "POST" }))

beforeEach(() => {
  vi.clearAllMocks()
  cron.isCron = false
  mailbox.mockResolvedValue({ accountId: "acct_mail", userId: "u_owner" })
  session.mockResolvedValue({ user: { id: "u_owner", role: "OWNER", accountId: "acct_mail" } })
  db.jobRun.findFirst.mockResolvedValue({ startedAt: new Date(), metadata: {} })
  db.store.findMany.mockResolvedValue([])
  db.invoiceLineItem.findMany.mockResolvedValue([])
  db.invoice.updateMany.mockResolvedValue({ count: 0 })
  let n = 0
  db.invoice.create.mockImplementation(async () => ({ id: `inv_${++n}` }))
  // findMany: [0] dedupe, then approved addresses / known vendors / retry.
  db.invoice.findMany.mockImplementation(async (args: { select?: Record<string, unknown>; where?: Record<string, unknown> }) => {
    if (args.select && "emailAttachmentIndex" in args.select) return []
    return []
  })
  matchNew.mockResolvedValue({ matchedBySku: 0, matchedByAlias: 0, matchedByName: 0, unmatched: 0, costsUpdated: 0 })
})

describe("POST /api/invoices/sync — every PDF", () => {
  it("stores two bills from one email as two rows, by attachment position", async () => {
    graph.fetchInvoiceEmails.mockResolvedValue([msg("m1")])
    graph.getEmailAttachments.mockResolvedValue([pdf("a.pdf"), pdf("b.pdf")])
    extract.mockImplementation(async (_b: string, name: string) => ({
      extraction: bill(name === "a.pdf" ? "A-1" : "B-2"),
      model: "gpt",
    }))

    const res = await post()
    const body = await res.json()

    expect(extract).toHaveBeenCalledTimes(2)
    expect(body.created).toBe(2)
    const rows = db.invoice.create.mock.calls.map(([a]) => a.data)
    expect(rows.map((r) => [r.emailMessageId, r.emailAttachmentIndex, r.invoiceNumber])).toEqual([
      ["m1", 0, "A-1"],
      ["m1", 1, "B-2"],
    ])
  })

  it("does not let a statement first set the bill after it aside", async () => {
    graph.fetchInvoiceEmails.mockResolvedValue([msg("m1", "Your documents")])
    graph.getEmailAttachments.mockResolvedValue([pdf("statement.pdf"), pdf("invoice.pdf")])
    extract.mockImplementation(async (_b: string, name: string) => ({
      extraction: name === "statement.pdf"
        ? { ...bill(""), lineItems: [], totalAmount: 0, subtotal: null }
        : bill("I-9"),
      model: "gpt",
    }))
    await post()
    const rows = db.invoice.create.mock.calls.map(([a]) => a.data)
    const byIndex = Object.fromEntries(rows.map((r) => [r.emailAttachmentIndex, r.status]))
    expect(byIndex[0]).toBe("REJECTED")
    expect(byIndex[1]).not.toBe("REJECTED")
  })

  it("reads only the PDF not stored yet in an email it has seen", async () => {
    graph.fetchInvoiceEmails.mockResolvedValue([msg("m1"), msg("m2")])
    db.invoice.findMany.mockImplementation(async (args: { select?: Record<string, unknown> }) =>
      args.select && "emailAttachmentIndex" in args.select
        ? [
            { emailMessageId: "m1", emailAttachmentIndex: 0 },
            { emailMessageId: "m2", emailAttachmentIndex: 0 },
          ]
        : []
    )
    // m1 has a second PDF the old sync never read; m2 had only the one.
    graph.countEmailPdfAttachments.mockImplementation(async (id: string) => (id === "m1" ? 2 : 1))
    graph.getEmailAttachments.mockResolvedValue([pdf("a.pdf"), pdf("b.pdf")])
    extract.mockResolvedValue({ extraction: bill("B-2"), model: "gpt" })

    await post()

    expect(graph.getEmailAttachments).toHaveBeenCalledTimes(1)
    expect(graph.getEmailAttachments).toHaveBeenCalledWith("m1")
    expect(extract).toHaveBeenCalledTimes(1)
    expect(extract.mock.calls[0][1]).toBe("b.pdf")
    expect(db.invoice.create.mock.calls[0][0].data.emailAttachmentIndex).toBe(1)
  })

  it("passes an abort signal and a budget to the read", async () => {
    graph.fetchInvoiceEmails.mockResolvedValue([msg("m1")])
    graph.getEmailAttachments.mockResolvedValue([pdf("a.pdf")])
    extract.mockResolvedValue({ extraction: bill("A-1"), model: "gpt" })
    await post()
    const opts = extract.mock.calls[0][2] as { signal: AbortSignal; budgetMs: number }
    expect(opts.signal).toBeInstanceOf(AbortSignal)
    expect(opts.budgetMs).toBeLessThan(60_000)
  })
})

describe("POST /api/invoices/sync — ingredient matching retry", () => {
  it("retries recent invoices whose matching never finished, and stamps them when it does", async () => {
    graph.fetchInvoiceEmails.mockResolvedValue([])
    db.invoice.findMany.mockImplementation(async (args: { where?: Record<string, unknown> }) =>
      args.where && "ingredientMatchedAt" in args.where ? [{ id: "inv_old" }] : []
    )
    await post()
    expect(matchNew).toHaveBeenCalledWith("acct_mail", ["inv_old"])
    const retryQuery = db.invoice.findMany.mock.calls.find(([a]) => a.where && "ingredientMatchedAt" in a.where)![0]
    expect(retryQuery.where).toMatchObject({ accountId: "acct_mail", ingredientMatchedAt: null, status: { not: "REJECTED" } })
    expect(retryQuery.take).toBeGreaterThan(0)
    expect(db.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["inv_old"] }, accountId: "acct_mail" },
      data: { ingredientMatchedAt: expect.any(Date) },
    })
  })

  it("leaves an invoice unstamped when matching fails, so the next run retries it", async () => {
    graph.fetchInvoiceEmails.mockResolvedValue([msg("m1")])
    graph.getEmailAttachments.mockResolvedValue([pdf("a.pdf")])
    extract.mockResolvedValue({ extraction: bill("A-1"), model: "gpt" })
    matchNew.mockRejectedValue(new Error("statement timeout"))
    const res = await post()
    expect(res.status).toBe(200)
    expect(matchNew).toHaveBeenCalledWith("acct_mail", ["inv_1"])
    expect(db.invoice.updateMany).not.toHaveBeenCalled()
  })
})

describe("POST /api/invoices/sync — account", () => {
  it("refuses an owner of another account", async () => {
    session.mockResolvedValue({ user: { id: "u_other", role: "OWNER", accountId: "acct_other" } })
    const res = await post()
    expect(res.status).toBe(403)
    expect(graph.fetchInvoiceEmails).not.toHaveBeenCalled()
  })

  it("files the cron's rows under the mailbox account and owner", async () => {
    cron.isCron = true
    graph.fetchInvoiceEmails.mockResolvedValue([msg("m1")])
    graph.getEmailAttachments.mockResolvedValue([pdf("a.pdf")])
    extract.mockResolvedValue({ extraction: bill("A-1"), model: "gpt" })
    await post()
    expect(session).not.toHaveBeenCalled()
    expect(db.invoice.create.mock.calls[0][0].data).toMatchObject({ accountId: "acct_mail", ownerId: "u_owner" })
  })
})
