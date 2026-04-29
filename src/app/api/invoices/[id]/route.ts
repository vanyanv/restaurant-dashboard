import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { InvoiceStatus } from "@/generated/prisma/client"
import { rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
import { bustTags } from "@/lib/cache/cached"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.moderate)
  if (limited) return limited

  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  const invoice = await prisma.invoice.findFirst({
    where: { id, ownerId: session.user.id },
    include: {
      store: { select: { name: true } },
      lineItems: { orderBy: { lineNumber: "asc" } },
    },
  })

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
  }

  return NextResponse.json({
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
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.moderate)
  if (limited) return limited

  const session = await getServerSession(authOptions)
  if (!session?.user || session.user.role !== "OWNER") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json()
  const { status, storeId } = body as { status?: InvoiceStatus; storeId?: string | null }

  const invoice = await prisma.invoice.findFirst({
    where: { id, ownerId: session.user.id },
  })

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
  }

  const updated = await prisma.invoice.update({
    where: { id },
    data: {
      ...(status ? { status } : {}),
      ...(storeId !== undefined ? { storeId } : {}),
      ...(status === "MATCHED" || status === "APPROVED" ? { matchedAt: new Date() } : {}),
    },
  })

  await bustTags([`owner:${session.user.id}`])
  return NextResponse.json({ id: updated.id, status: updated.status, storeId: updated.storeId })
}
