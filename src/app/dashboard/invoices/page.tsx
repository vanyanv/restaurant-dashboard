import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { InvoicesShell } from "./components/invoices-shell"
import { parseInvoiceFilters } from "./components/sections/data"

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    storeId?: string
    status?: string
    vendor?: string
    period?: string
    startDate?: string
    endDate?: string
    page?: string
  }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sp = await searchParams
  const filters = parseInvoiceFilters(sp)

  return <InvoicesShell userId={session.user.id} filters={filters} />
}
