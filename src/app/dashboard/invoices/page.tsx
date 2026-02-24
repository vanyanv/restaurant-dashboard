import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getInvoiceSummary, getInvoiceList, getProductAnalytics, getLastInvoiceSyncAt } from "@/app/actions/invoice-actions"
import { InvoicesContent } from "./components/invoices-content"

export default async function InvoicesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const [summary, invoices, products, lastSyncAt, stores] = await Promise.all([
    getInvoiceSummary(),
    getInvoiceList(),
    getProductAnalytics(),
    getLastInvoiceSyncAt(),
    prisma.store.findMany({
      where: { ownerId: session.user.id, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ])

  return (
    <InvoicesContent
      initialSummary={summary}
      initialInvoices={invoices}
      initialProducts={products}
      lastSyncAt={lastSyncAt}
      stores={stores}
    />
  )
}
