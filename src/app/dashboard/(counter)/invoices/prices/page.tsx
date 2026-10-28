import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getPriceSectionPromises } from "@/lib/counter/adapters/prices"
import { InvoicePricesClient } from "./invoice-prices-client"

export const dynamic = "force-dynamic"

/**
 * Invoices — Prices. The Price monitor's own sections (`adapters/prices.ts`),
 * drawn inside Invoices: one function owns "what a price move costs you", and
 * this tab and `/dashboard/ingredients/prices` both read it.
 */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getPriceSectionPromises(session.user.accountId)

  return (
    <>
      <InvoicePricesClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/invoices/prices" />
    </>
  )
}
