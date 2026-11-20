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
const identities = vi.hoisted(() => ({ seen: new Set<string>() }))
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
  loadInvoiceIdentities: vi.fn(async () => new Set(identities.seen)),
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
  identities.seen = new Set()
  mailbox.mockResolvedValue({ ok: true, accountId: "acct_mail", userId: "u_owner" })
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

const metadataWritten = () => db.jobRun.update.mock.calls.at(-1)![0].data.metadata as Record<string, unknown>
const storedRows = (rows: Array<{ emailMessageId: string; emailAttachmentIndex: number }>) =>
  db.invoice.findMany.mockImplementation(async (args: { select?: Record<string, unknown> }) =>
    args.select && "emailAttachmentIndex" in args.select ? rows : []
  )
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

describe("POST /api/invoices/sync — every PDF gets an outcome", () => {
  it("stores a second copy of a bill set aside as a duplicate, so it is not re-read every run", async () => {
    identities.seen = new Set(["A-1"])
    graph.fetchInvoiceEmails.mockResolvedValue([msg("m1")])
    graph.getEmailAttachments.mockResolvedValue([pdf("a.pdf")])
    extract.mockResolvedValue({ extraction: bill("A-1"), model: "gpt" })
    const body = await (await post()).json()
    expect(body.created).toBe(0)
    const row = db.invoice.create.mock.calls[0][0].data
    expect(row.status).toBe("REJECTED")
    expect(row.reviewReasons[0].kind).toBe("duplicate_bill")
    expect(row.lineItems.create).toEqual([])
    expect(matchNew).not.toHaveBeenCalled()
  })

  it("counts a failed read and tries again next run", async () => {
    graph.fetchInvoiceEmails.mockResolvedValue([msg("m1")])
    graph.getEmailAttachments.mockResolvedValue([pdf("a.pdf")])
    extract.mockRejectedValue(new Error("503"))
    await post()
    expect(db.invoice.create).not.toHaveBeenCalled()
    expect(metadataWritten().readFailures).toEqual({ "m1#0": 1 })
  })

  it("holds a PDF for review after its third failed read and stops counting it", async () => {
    db.jobRun.findFirst.mockResolvedValue({ startedAt: new Date(), metadata: { readFailures: { "m1#0": 2 } } })
    graph.fetchInvoiceEmails.mockResolvedValue([msg("m1")])
    graph.getEmailAttachments.mockResolvedValue([pdf("a.pdf")])
    extract.mockRejectedValue(new Error("503"))
    await post()
    const row = db.invoice.create.mock.calls[0][0].data
    expect(row).toMatchObject({ status: "REVIEW", emailMessageId: "m1", emailAttachmentIndex: 0, totalAmount: 0 })
    expect(row.reviewReasons[0].kind).toBe("unreadable_pdf")
    expect(metadataWritten().readFailures).toEqual({})
  })

  it("keeps an email cut by the per-run PDF cap pending for the next run", async () => {
    graph.fetchInvoiceEmails.mockResolvedValue([msg("m1")])
    graph.getEmailAttachments.mockResolvedValue(Array.from({ length: 9 }, (_, i) => pdf(`p${i}.pdf`)))
    extract.mockImplementation(async (_b: string, name: string) => ({ extraction: bill(`N-${name}`), model: "gpt" }))
    const body = await (await post()).json()
    expect(extract).toHaveBeenCalledTimes(8)
    expect(body.deferred).toBe(1)
    expect((metadataWritten().incomplete as Array<{ id: string }>).map((e) => e.id)).toEqual(["m1"])
  })

  it("finishes a half-stored email however old it is, widening the window to reach it", async () => {
    const old = { ...msg("m_old"), receivedDateTime: daysAgo(20) }
    db.jobRun.findFirst.mockResolvedValue({
      startedAt: new Date(),
      metadata: { incomplete: [{ id: "m_old", receivedAt: old.receivedDateTime }] },
    })
    graph.fetchInvoiceEmails.mockResolvedValue([old])
    storedRows([{ emailMessageId: "m_old", emailAttachmentIndex: 0 }])
    graph.getEmailAttachments.mockResolvedValue([pdf("a.pdf"), pdf("b.pdf")])
    extract.mockResolvedValue({ extraction: bill("B-2"), model: "gpt" })
    await post()
    const since = graph.fetchInvoiceEmails.mock.calls[0][0] as Date
    expect(since.getTime()).toBeLessThanOrEqual(Date.parse(old.receivedDateTime))
    // Older than the 7-day re-check, read anyway because the last run left it open.
    expect(graph.countEmailPdfAttachments).not.toHaveBeenCalled()
    expect(extract).toHaveBeenCalledTimes(1)
    expect(db.invoice.create.mock.calls[0][0].data.emailAttachmentIndex).toBe(1)
    expect(metadataWritten().incomplete).toEqual([])
  })

  it("reads new mail before half-stored emails, which get their own small budget", async () => {
    const fresh = Array.from({ length: 6 }, (_, i) => ({ ...msg(`new${i}`), receivedDateTime: daysAgo(1) }))
    const partial = Array.from({ length: 3 }, (_, i) => ({ ...msg(`part${i}`), receivedDateTime: daysAgo(3) }))
    db.jobRun.findFirst.mockResolvedValue({
      startedAt: new Date(),
      metadata: { incomplete: partial.map((m) => ({ id: m.id, receivedAt: m.receivedDateTime })) },
    })
    graph.fetchInvoiceEmails.mockResolvedValue([...partial, ...fresh])
    storedRows(partial.map((m) => ({ emailMessageId: m.id, emailAttachmentIndex: 0 })))
    graph.getEmailAttachments.mockImplementation(async (id: string) =>
      id.startsWith("part") ? [pdf("a.pdf"), pdf(`${id}-b.pdf`)] : [pdf(`${id}.pdf`)]
    )
    extract.mockImplementation(async (_b: string, name: string) => ({ extraction: bill(`N-${name}`), model: "gpt" }))
    await post()
    const fetched = graph.getEmailAttachments.mock.calls.map(([id]) => id)
    // All six new emails, then only two of the three older ones.
    expect(fetched.filter((id) => id.startsWith("new"))).toHaveLength(6)
    expect(fetched.filter((id) => id.startsWith("part"))).toEqual(["part0", "part1"])
    // The third stays pending for the next run.
    expect((metadataWritten().incomplete as Array<{ id: string }>).map((e) => e.id)).toEqual(["part2"])
  })

  it("does not download an email with no PDF again once it is known to have none", async () => {
    db.jobRun.findFirst.mockResolvedValue({ startedAt: new Date(), metadata: { noPdf: ["m1"] } })
    graph.fetchInvoiceEmails.mockResolvedValue([msg("m1")])
    await post()
    expect(graph.getEmailAttachments).not.toHaveBeenCalled()
  })
})
