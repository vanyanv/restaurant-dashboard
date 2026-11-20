// Server-only, not a server action: nothing in the browser calls these, so
// they are plain functions and cannot be invoked from outside the server.
// Browser saves go through `src/lib/counter/actions/`.
import "server-only"
import { getSession } from "@/lib/auth-scope"
import { hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { bustTags, cached, stableKey } from "@/lib/cache/cached"
import { recomputeCanonicalCost } from "@/lib/ingredient-cost"
import type { InvoiceKpis } from "@/types/invoice"
import { logger } from "@/lib/logger"
import { tieOut } from "@/lib/invoice-charges"

function isoToStartOfDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

function isoToEndOfDay(iso: string): Date {
  return new Date(`${iso}T23:59:59.999`)
}

export async function getInvoiceSummary(options?: {
  storeId?: string
  days?: number
  startDate?: string
  endDate?: string
}): Promise<InvoiceKpis> {
  const session = await getSession()
  if (!session?.user) {
    return {
      totalSpend: 0, invoiceCount: 0, avgInvoiceTotal: 0,
      pendingReviewCount: 0, pendingReviewTotal: 0, vendorCount: 0,
      spendByVendor: [], spendByCategory: [],
    }
  }
  const accountId = session.user.accountId

  return cached(
    `inv:account:${accountId}:${stableKey(options ?? {})}`,
    300,
    ["invoices", `account:${accountId}`],
    async () => {
  const { storeId, days, startDate, endDate } = options ?? {}

  const where: any = { accountId }
  if (storeId) where.storeId = storeId
  if (startDate && endDate) {
    where.invoiceDate = {
      gte: isoToStartOfDay(startDate),
      lte: isoToEndOfDay(endDate),
    }
  } else if (days) {
    // Calendar-aligned window: N full days ending today at 23:59:59.999,
    // so the "days: 30" home KPI matches the invoices page's "month" preset
    // which spans the last 29 days + today (also 30 calendar days inclusive).
    // Also bounds-above now() so future-dated rows don't silently inflate the total.
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    const start = new Date(end)
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - (days - 1))
    where.invoiceDate = { gte: start, lte: end }
  }

  // One groupBy across vendors avoids pulling every matching invoice row
  // out of Postgres just to sum + bucket them in JS. For owners with
  // hundreds of vendors and thousands of invoices, this is the difference
  // between a multi-MB result and a few KB.
  const [vendorGroups, pendingReview, lineItems] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["vendorName"],
      where,
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    prisma.invoice.aggregate({
      where: { ...where, status: "REVIEW" },
      _count: { _all: true },
      // The dollar value of what is held. It is not missing from COGS — COGS
      // is recipe cost × sales — but none of its lines price an ingredient
      // until it is verified (`isLinePriceable`), and the overview says so.
      _sum: { totalAmount: true },
    }),
    prisma.invoiceLineItem.findMany({
      where: { invoice: where },
      select: { category: true, extendedPrice: true },
    }),
  ])

  const totalSpend = vendorGroups.reduce(
    (sum, g) => sum + (g._sum.totalAmount ?? 0),
    0,
  )
  const invoiceCount = vendorGroups.reduce((sum, g) => sum + g._count._all, 0)
  const avgInvoiceTotal = invoiceCount > 0 ? totalSpend / invoiceCount : 0

  // groupBy runs on the raw vendorName, so the same supplier arriving under two
  // invoice templates ("Vitco Foodservice" / "VITCO FOOD SERVICE") produced two
  // bars on the chart and inflated the unique-vendor count. Merge on the
  // canonical name — the same normaliser the ingredient matcher already uses.
  const byCanonicalVendor = new Map<string, number>()
  for (const g of vendorGroups) {
    const key = normalizeVendorName(g.vendorName)
    byCanonicalVendor.set(
      key,
      (byCanonicalVendor.get(key) ?? 0) + (g._sum.totalAmount ?? 0),
    )
  }
  const vendorCount = byCanonicalVendor.size

  const spendByVendor = [...byCanonicalVendor.entries()]
    .map(([vendor, total]) => ({ vendor, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  // Spend by category
  const categoryMap: Record<string, number> = {}
  for (const li of lineItems) {
    const cat = li.category ?? "Other"
    categoryMap[cat] = (categoryMap[cat] ?? 0) + li.extendedPrice
  }
  const spendByCategory = Object.entries(categoryMap)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total)

  return {
    totalSpend,
    invoiceCount,
    avgInvoiceTotal,
    pendingReviewCount: pendingReview._count._all,
    pendingReviewTotal: pendingReview._sum.totalAmount ?? 0,
    vendorCount,
    spendByVendor,
    spendByCategory,
  }
    },
  )
}

export async function getLastInvoiceSyncAt(): Promise<string | null> {
  const lastSync = await prisma.jobRun.findFirst({
    where: { jobName: "invoices.email.sync", status: "SUCCESS" },
    orderBy: { startedAt: "desc" },
    select: { completedAt: true },
  })
  return lastSync?.completedAt?.toISOString() ?? null
}

/**
 * Toggle an invoice between regular-purchase and return/credit-memo.
 *
 * When `isReturn` flips, every monetary field (totalAmount, subtotal,
 * taxAmount, and per-line quantity / unitPrice / extendedPrice) is rewritten
 * with `Math.abs(...) * (isReturn ? -1 : 1)`. That makes the operation
 * idempotent — toggling twice converges on the original signs — and survives
 * accidental double-clicks. Canonical ingredient costs are re-derived for any
 * affected ingredient so unit-price history stays consistent.
 *
 * Owner-only. Returns `{ ok: true }` on success, `{ ok: false, reason }` for
 * permission/lookup failures.
 */
export async function setInvoiceIsReturn(
  invoiceId: string,
  isReturn: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const session = await getSession()
  if (!session?.user) return { ok: false, reason: "unauthenticated" }
  if (!hasOwnerAccess(session.user.role)) return { ok: false, reason: "forbidden" }
  const accountId = session.user.accountId

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId },
    select: {
      id: true,
      isReturn: true,
      totalAmount: true,
      subtotal: true,
      taxAmount: true,
      lineItems: {
        select: {
          canonicalIngredientId: true,
        },
      },
    },
  })
  if (!invoice) return { ok: false, reason: "not-found" }
  if (invoice.isReturn === isReturn) return { ok: true }

  const sign = isReturn ? -1 : 1

  await prisma.$transaction([
    prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        isReturn,
        totalAmount: Math.abs(invoice.totalAmount) * sign,
        subtotal: invoice.subtotal === null ? null : Math.abs(invoice.subtotal) * sign,
        taxAmount: invoice.taxAmount === null ? null : Math.abs(invoice.taxAmount) * sign,
      },
    }),
    // Every line in one statement (it was one UPDATE per line). unitPrice
    // stays positive — only quantity flips. extendedPrice mirrors the
    // (signed) total so quantity * unitPrice = extendedPrice. Same
    // abs-times-sign as the header, so toggling twice is still a no-op.
    prisma.$executeRaw`
      UPDATE "InvoiceLineItem" SET
        "quantity" = ABS("quantity") * ${sign}::float8,
        "extendedPrice" = ABS("extendedPrice") * ${sign}::float8
      WHERE "invoiceId" = ${invoice.id}`,
  ])

  // Re-derive canonical cost for any matched ingredient touched by this
  // invoice — toggling the sign can change which line is "most recent" or
  // make a previously-skipped line eligible.
  const canonicalIds = Array.from(
    new Set(
      invoice.lineItems
        .map((li) => li.canonicalIngredientId)
        .filter((id): id is string => id !== null),
    ),
  )
  for (const id of canonicalIds) {
    try {
      await recomputeCanonicalCost(id)
    } catch (err) {
      logger.error(`recomputeCanonicalCost(${id}) failed after isReturn toggle:`, err)
    }
  }

  await bustTags(["invoices", `account:${accountId}`])
  return { ok: true }
}

/**
 * Resolve an invoice sitting in REVIEW.
 *
 * ## Why this action exists
 *
 * `Invoice.status` has carried APPROVED and REJECTED since the enum was
 * written, and `PATCH /api/invoices/[id]` has been able to set them for just
 * as long. No screen has ever called it. The sync routes an invoice to REVIEW
 * whenever `src/lib/invoice-sanity.ts` finds something it cannot vouch for,
 * writes the `reviewReasons` explaining why, and the owner's only recourse
 * was to read the explanation and close the tab. **A queue nothing can drain
 * is not a queue, it is a list of complaints**, and this account has been
 * accumulating one.
 *
 * ## What a decision means
 *
 * APPROVED is the owner overriding the sanity check: the numbers are right,
 * count them. REJECTED is the owner agreeing the document is bad: the totals
 * are wrong, or it is a duplicate, or it never should have been ingested.
 *
 * Neither writes to the line items. That is deliberate and it is the
 * difference between this and `setInvoiceIsReturn`, which flips signs on the
 * whole document: a review decision is a judgement ABOUT the record, not an
 * edit OF it, so the extracted figures stay exactly as the model read them
 * and the decision is recoverable by setting the status back.
 *
 * `matchedAt` is stamped on APPROVED to match what the REST route already
 * does, so the two paths cannot leave the column in different states.
 *
 * ## What still counts
 *
 * REJECTED invoices are NOT excluded from spend arithmetic here, because no
 * spend query in this codebase filters on `status` today — they filter on
 * `isReturn` and on date. Making rejection subtract money is a separate
 * change with its own reconciliation, and quietly doing half of it inside a
 * status write is how a total starts disagreeing with itself. An owner who
 * wants a bad invoice out of the numbers marks it a return; rejection records
 * the judgement and takes it off the queue.
 *
 * The one exception is the usage comparison: `src/lib/counter/purchases.ts`
 * (Product usage, Inventory's "delivered") leaves REJECTED invoices out of
 * what was bought, because setting a disowned document against what the
 * recipes used reports a gap the owner has already explained.
 */
export async function setInvoiceReviewDecision(
  invoiceId: string,
  decision: "APPROVED" | "REJECTED" | "REVIEW",
): Promise<{ ok: true; status: string } | { ok: false; reason: string }> {
  const session = await getSession()
  if (!session?.user) return { ok: false, reason: "unauthenticated" }
  if (!hasOwnerAccess(session.user.role)) return { ok: false, reason: "forbidden" }
  const accountId = session.user.accountId

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId },
    select: { id: true, status: true },
  })
  if (!invoice) return { ok: false, reason: "not-found" }
  if (invoice.status === decision) return { ok: true, status: invoice.status }

  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: decision,
      ...(decision === "APPROVED" ? { matchedAt: new Date() } : {}),
    },
    select: { status: true },
  })

  await bustTags(["invoices", `account:${accountId}`])
  return { ok: true, status: updated.status }
}

/**
 * Answers "which store is this?" for an invoice the sync held because the
 * delivery address only partly matched (`low_match_confidence`).
 *
 * The store must be one of the reader's own account's stores, and the invoice
 * must be the account's too: `accountId` is the tenancy boundary, the same
 * check `PATCH /api/invoices/[id]` makes. Confirming IS the review decision, so
 * the invoice is APPROVED in the same write (and `matchedAt` stamped, as
 * `setInvoiceReviewDecision` does). Only REVIEW invoices are moved this way:
 * a settled invoice changing store is a different question, asked on its page.
 */
export async function setInvoiceStore(
  invoiceId: string,
  storeId: string,
): Promise<{ ok: true; storeId: string } | { ok: false; reason: string }> {
  const session = await getSession()
  if (!session?.user) return { ok: false, reason: "unauthenticated" }
  if (!hasOwnerAccess(session.user.role)) return { ok: false, reason: "forbidden" }
  const accountId = session.user.accountId

  const [invoice, store] = await Promise.all([
    prisma.invoice.findFirst({
      where: { id: invoiceId, accountId },
      select: {
        id: true,
        status: true,
        reviewReasons: true,
        subtotal: true,
        taxAmount: true,
        totalAmount: true,
        lineItems: { select: { productName: true, sku: true, extendedPrice: true } },
      },
    }),
    prisma.store.findFirst({ where: { id: storeId, accountId }, select: { id: true } }),
  ])
  if (!invoice) return { ok: false, reason: "not-found" }
  if (!store) return { ok: false, reason: "store-not-found" }
  if (invoice.status !== "REVIEW") return { ok: false, reason: "not-in-review" }
  // Only the store question is answered here. An invoice held for anything
  // else, or whose lines do not tie out, is approved on its own page, where
  // the Approve gate can say why it is locked.
  const reasons = Array.isArray(invoice.reviewReasons) ? invoice.reviewReasons : []
  const storeOnly =
    reasons.length > 0 &&
    reasons.every((r) => !!r && typeof r === "object" && "kind" in r && r.kind === "low_match_confidence")
  if (!storeOnly) return { ok: false, reason: "not-store-only" }
  if (!tieOut(invoice.lineItems, invoice).reconciles) return { ok: false, reason: "does-not-tie-out" }

  // Conditional on REVIEW in the write itself, so a reject from another tab
  // between the read and this write is not silently turned into an approval.
  const moved = await prisma.invoice.updateMany({
    where: { id: invoice.id, accountId, status: "REVIEW" },
    data: { storeId: store.id, status: "APPROVED", matchedAt: new Date() },
  })
  if (moved.count === 0) return { ok: false, reason: "not-in-review" }

  await bustTags(["invoices", `account:${accountId}`])
  return { ok: true, storeId: store.id }
}
