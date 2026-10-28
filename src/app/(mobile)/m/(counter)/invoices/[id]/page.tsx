import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getInvoiceName, getInvoiceSectionPromises } from "@/lib/counter/adapters/invoice"
import { CounterInvoiceClient } from "@/app/dashboard/(counter)/invoices/[id]/counter-invoice-client"

export const dynamic = "force-dynamic"

/**
 * One invoice, on a phone: the desk review page (decision, the PDF, "What we
 * checked", the lines) drawn in the phone shell. The desk client takes a
 * store list it does not read, so this page skips that query.
 */
export default async function MobileInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const { id } = await params
  const named = await getInvoiceName(id, session.user.accountId)
  if (!named) notFound()

  const sections = getInvoiceSectionPromises({
    invoiceId: id,
    accountId: session.user.accountId,
  })

  return (
    <>
      <CounterInvoiceClient stores={[]} title={named.name} vendor={named.vendor} sections={sections} />
      <span hidden data-perf-ready="/m/invoices/[id]" />
    </>
  )
}
