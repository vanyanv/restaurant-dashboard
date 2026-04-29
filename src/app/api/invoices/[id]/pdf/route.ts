import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getInvoicePdfStream } from "@/lib/blob"
import { rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"

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
    where: { id, accountId: session.user.accountId },
    select: { pdfBlobPathname: true },
  })

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
  }

  if (!invoice.pdfBlobPathname) {
    return NextResponse.json({ error: "PDF not available" }, { status: 404 })
  }

  const result = await getInvoicePdfStream(invoice.pdfBlobPathname)
  if (!result || result.statusCode !== 200) {
    return NextResponse.json({ error: "PDF not found in storage" }, { status: 404 })
  }

  return new Response(result.stream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="invoice-${id}.pdf"`,
      "Cache-Control": "private, max-age=3600",
    },
  })
}
