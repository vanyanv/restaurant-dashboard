import { redirect, notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { InvoiceDetailContent } from "./components/invoice-detail"

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const { id } = await params

  const invoice = await prisma.invoice.findFirst({
    where: { id, ownerId: session.user.id },
    include: {
      store: { select: { id: true, name: true } },
      lineItems: { orderBy: { lineNumber: "asc" } },
    },
  })

  if (!invoice) notFound()

  const stores = await prisma.store.findMany({
    where: { ownerId: session.user.id, isActive: true },
    select: { id: true, name: true },
  })

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
        storeName: invoice.store?.name ?? null,
        storeId: invoice.storeId,
        matchConfidence: invoice.matchConfidence,
        emailSubject: invoice.emailSubject,
        emailReceivedAt: invoice.emailReceivedAt?.toISOString() ?? null,
        attachmentName: invoice.attachmentName,
        hasPdf: Boolean(invoice.pdfBlobPathname),
        lineItemCount: invoice.lineItems.length,
        createdAt: invoice.createdAt.toISOString(),
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
