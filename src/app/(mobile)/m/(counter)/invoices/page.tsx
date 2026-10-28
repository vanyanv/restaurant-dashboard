import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getInvoicesSectionPromises } from "@/lib/counter/adapters/invoices"
import { getPriceSectionPromises } from "@/lib/counter/adapters/prices"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterInvoicesClient } from "@/app/dashboard/(counter)/invoices/counter-invoices-client"
import { counterToday } from "@/lib/counter/today"

export const dynamic = "force-dynamic"

/** Invoices — Needs you, on a phone: the desk client drawn in the phone shell. */
export default async function MobileInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.set(key, value)
  }

  const today = counterToday()
  const counterParams = readCounterParams(params, today)
  const stores = await getOverviewStores()
  const storeName = stores.find((s) => s.id === counterParams.storeId)?.name ?? "All stores"

  const sections = getInvoicesSectionPromises({
    range: counterParams.range,
    presetId: counterParams.presetId,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    today,
  })
  const prices = getPriceSectionPromises(session.user.accountId)

  return (
    <>
      <CounterInvoicesClient
        sub={`${storeName} · read from the invoices inbox`}
        sections={{ headline: sections.headline, desk: sections.desk }}
        prices={{ movers: prices.movers }}
      />
      <span hidden data-perf-ready="/m/invoices" />
    </>
  )
}
