import { redirect, notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  composeReviewReasons,
  findLineMathMismatches,
  findPackShapeAnomalies,
  findTotalReconciliationMismatch,
  type ReviewReason,
} from "@/lib/invoice-sanity"
import type { InvoiceExtraction } from "@/types/invoice"
import { InvoiceDetailContent } from "./components/invoice-detail"

/**
 * Invoices flagged before reviewReasons existed have nothing stored — but the
 * raw extraction is on the row, so the same checks the sync ran can be replayed
 * at read time. Best-effort: a parse failure just means no reasons shown.
 */
function recomputeLegacyReasons(input: {
  rawExtractionJson: string | null
  invoiceDate: Date | null
  matchConfidence: number | null
  storeId: string | null
}): ReviewReason[] {
  if (!input.rawExtractionJson) return []
  try {
    const extraction = JSON.parse(input.rawExtractionJson) as InvoiceExtraction
    if (!Array.isArray(extraction.lineItems)) return []
    return composeReviewReasons({
      // The sync nulls a suspect date; extraction still carrying one while the
      // row has none is the recorded symptom.
      dateSuspect: Boolean(extraction.invoiceDate) && input.invoiceDate == null,
      mathMismatches: findLineMathMismatches(extraction.lineItems),
      packAnomalies: findPackShapeAnomalies(extraction.lineItems),
      totalMismatch: findTotalReconciliationMismatch(extraction),
      matchConfidence: input.matchConfidence,
      matched: input.storeId != null,
    })
  } catch {
    return []
  }
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const { id } = await params

  const invoice = await prisma.invoice.findFirst({
    where: { id, accountId: session.user.accountId },
    select: {
      id: true,
      vendorName: true,
      invoiceNumber: true,
      invoiceDate: true,
      dueDate: true,
      deliveryAddress: true,
      totalAmount: true,
      subtotal: true,
      taxAmount: true,
      status: true,
      isReturn: true,
      storeId: true,
      matchConfidence: true,
      reviewReasons: true,
      rawExtractionJson: true,
      emailSubject: true,
      emailReceivedAt: true,
      attachmentName: true,
      pdfBlobPathname: true,
      createdAt: true,
      store: { select: { id: true, name: true } },
      lineItems: {
        orderBy: { lineNumber: "asc" },
        select: {
          id: true,
          lineNumber: true,
          sku: true,
          productName: true,
          description: true,
          category: true,
          quantity: true,
          unit: true,
          packSize: true,
          unitSize: true,
          unitSizeUom: true,
          unitPrice: true,
          extendedPrice: true,
        },
      },
    },
  })

  if (!invoice) notFound()

  const stores = await prisma.store.findMany({
    where: { accountId: session.user.accountId, isActive: true },
    select: { id: true, name: true },
  })

  const storedReasons = invoice.reviewReasons as ReviewReason[] | null
  let reviewReasons: ReviewReason[] =
    invoice.status !== "REVIEW"
      ? []
      : storedReasons && storedReasons.length > 0
        ? storedReasons
        : recomputeLegacyReasons({
            rawExtractionJson: invoice.rawExtractionJson,
            invoiceDate: invoice.invoiceDate,
            matchConfidence: invoice.matchConfidence,
            storeId: invoice.storeId,
          })
  // Still in REVIEW but today's checks come back clean: an older sync flagged
  // it under rules that have since changed. Say so instead of showing nothing.
  if (invoice.status === "REVIEW" && reviewReasons.length === 0) {
    reviewReasons = [
      {
        kind: "unknown",
        message:
          "Flagged by an earlier sync whose reason wasn't recorded. Today's checks find nothing wrong — spot-check the totals against the PDF, then approve or reject.",
      },
    ]
  }

  return (
    <InvoiceDetailContent
      invoice={{
        id: invoice.id,
        vendorName: invoice.vendorName,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate?.toISOString().slice(0, 10) ?? null,
        dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
        deliveryAddress: invoice.deliveryAddress,
        totalAmount: invoice.totalAmount,
        subtotal: invoice.subtotal,
        taxAmount: invoice.taxAmount,
        status: invoice.status,
        isReturn: invoice.isReturn,
        storeName: invoice.store?.name ?? null,
        storeId: invoice.storeId,
        matchConfidence: invoice.matchConfidence,
        emailSubject: invoice.emailSubject,
        emailReceivedAt: invoice.emailReceivedAt?.toISOString() ?? null,
        attachmentName: invoice.attachmentName,
        hasPdf: Boolean(invoice.pdfBlobPathname),
        lineItemCount: invoice.lineItems.length,
        createdAt: invoice.createdAt.toISOString(),
        reviewReasons,
        lineItems: invoice.lineItems.map((li) => ({
          id: li.id,
          lineNumber: li.lineNumber,
          sku: li.sku,
          productName: li.productName,
          description: li.description,
          category: li.category,
          quantity: li.quantity,
          unit: li.unit,
          packSize: li.packSize,
          unitSize: li.unitSize,
          unitSizeUom: li.unitSizeUom,
          unitPrice: li.unitPrice,
          extendedPrice: li.extendedPrice,
        })),
      }}
      stores={stores}
    />
  )
}
