import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getInvoiceName, getInvoiceSectionPromises } from "@/lib/counter/adapters/invoice"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterInvoiceClient } from "./counter-invoice-client"

export const dynamic = "force-dynamic"

/**
 * One invoice — `P.invoice` (`docs/counter/counter-prototype.html`).
 *
 * `nodate: true` in the prototype: an invoice is a record, not a range, so
 * this route reads no date control and passes none.
 */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const { id } = await params

  const [stores, named] = await Promise.all([
    getOverviewStores(),
    getInvoiceName(id, session.user.accountId),
  ])
  if (!named) notFound()

  const sections = getInvoiceSectionPromises({
    invoiceId: id,
    accountId: session.user.accountId,
  })

  return (
    <>
      <CounterInvoiceClient
        stores={stores}
        title={named.name}
        vendor={named.vendor}
        sections={sections}
      />
      <span hidden data-perf-ready="/dashboard/invoices/[id]" />
    </>
  )
}
