import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getInvoiceName, getInvoiceSectionPromises } from "@/lib/counter/adapters/invoice"
import { CounterPhoneInvoiceClient } from "./counter-phone-invoice-client"

export const dynamic = "force-dynamic"

/** One invoice, on a phone — `P.invoice.phone()`. */
export default async function MobileInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
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
      <CounterPhoneInvoiceClient
        title={named.name}
        vendor={named.vendor}
        sections={sections}
      />
      <span hidden data-perf-ready="/m/invoices/[id]" />
    </>
  )
}
