import { prisma } from "@/lib/prisma"
import { buildPackShapePriors, type PackShapePrior } from "@/lib/invoice-pack-prior"
import { isLinePriceable, PRICED_INVOICE_STATUSES } from "@/lib/invoice-verify"

/**
 * The pack-shape priors for these SKUs on this account, from verified lines
 * only: lines on MATCHED or APPROVED invoices that the sync did not itself
 * mark as unverifiable. A shape the sync could not check must never become
 * the history the next delivery is checked against — three of them would
 * otherwise turn a misread into the "accepted" shape.
 *
 * Shared by the sync route and `scripts/reverify-review-invoices.ts`, so the
 * two judge an invoice against the same history.
 */
export async function loadPackShapePriors(
  accountId: string,
  skus: string[],
): Promise<Map<string, PackShapePrior>> {
  if (skus.length === 0) return new Map()
  const rows = await prisma.invoiceLineItem.findMany({
    where: {
      sku: { in: skus },
      invoice: { accountId, status: { in: [...PRICED_INVOICE_STATUSES] } },
    },
    select: {
      lineNumber: true,
      sku: true,
      productName: true,
      category: true,
      unit: true,
      packSize: true,
      unitSize: true,
      unitSizeUom: true,
      invoice: { select: { vendorName: true, status: true, reviewReasons: true } },
    },
  })
  return buildPackShapePriors(
    rows
      .filter((r) => isLinePriceable(r.invoice, r.lineNumber))
      .map((r) => ({
        vendorName: r.invoice.vendorName,
        sku: r.sku,
        productName: r.productName,
        category: r.category,
        unit: r.unit,
        packSize: r.packSize,
        unitSize: r.unitSize,
        unitSizeUom: r.unitSizeUom,
        approved: r.invoice.status === "APPROVED",
      })),
  )
}
