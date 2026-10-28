import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getPriceSectionPromises } from "@/lib/counter/adapters/prices"
import { InvoicePricesClient } from "@/app/dashboard/(counter)/invoices/prices/invoice-prices-client"

export const dynamic = "force-dynamic"

/** Invoices — Prices, on a phone: the desk client drawn in the phone shell. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getPriceSectionPromises(session.user.accountId)

  return (
    <>
      <InvoicePricesClient sections={sections} />
      <span hidden data-perf-ready="/m/invoices/prices" />
    </>
  )
}
