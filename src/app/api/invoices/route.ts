import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { InvoiceStatus } from "@/generated/prisma/client"
import { rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
import { bustTags } from "@/lib/cache/cached"

export async function GET(request: NextRequest) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.moderate)
  if (limited) return limited

  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const storeId = url.searchParams.get("storeId")
  const status = url.searchParams.get("status")
  const vendorName = url.searchParams.get("vendor")
  const startDate = url.searchParams.get("startDate")
  const endDate = url.searchParams.get("endDate")
  const page = parseInt(url.searchParams.get("page") ?? "1", 10)
  const limit = parseInt(url.searchParams.get("limit") ?? "25", 10)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {}

  if (session.user.role === "OWNER") {
    where.ownerId = session.user.id
  }
  if (storeId) where.storeId = storeId
  if (status) where.status = status as InvoiceStatus
  if (vendorName) where.vendorName = { contains: vendorName, mode: "insensitive" }
  if (startDate) where.invoiceDate = { ...where.invoiceDate, gte: new Date(startDate) }
  if (endDate) where.invoiceDate = { ...where.invoiceDate, lte: new Date(endDate) }

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        store: { select: { name: true } },
        _count: { select: { lineItems: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.invoice.count({ where }),
  ])

  return NextResponse.json({
    invoices: invoices.map((inv) => ({
      id: inv.id,
      vendorName: inv.vendorName,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate?.toISOString().slice(0, 10) ?? null,
      totalAmount: inv.totalAmount,
      status: inv.status,
      storeName: inv.store?.name ?? null,
      storeId: inv.storeId,
      matchConfidence: inv.matchConfidence,
      lineItemCount: inv._count.lineItems,
      createdAt: inv.createdAt.toISOString(),
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  })
}

export async function PATCH(request: NextRequest) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.moderate)
  if (limited) return limited

  const session = await getServerSession(authOptions)
  if (!session?.user || session.user.role !== "OWNER") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { invoiceIds, status, storeId } = body as {
    invoiceIds: string[]
    status: InvoiceStatus
    storeId?: string
  }

  if (!invoiceIds?.length || !status) {
    return NextResponse.json({ error: "invoiceIds and status are required" }, { status: 400 })
  }

  const updated = await prisma.invoice.updateMany({
    where: {
      id: { in: invoiceIds },
      ownerId: session.user.id,
    },
    data: {
      status,
      ...(storeId !== undefined ? { storeId } : {}),
      ...(status === "MATCHED" || status === "APPROVED" ? { matchedAt: new Date() } : {}),
    },
  })

  await bustTags([`owner:${session.user.id}`])
  return NextResponse.json({ updated: updated.count })
}
