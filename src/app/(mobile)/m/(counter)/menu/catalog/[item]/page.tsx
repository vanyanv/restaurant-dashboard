import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getMenuItemSections } from "@/lib/counter/adapters/menu-item"
import { isMissing } from "@/lib/counter/section-data"
import { CounterPhoneMenuItemClient } from "./counter-phone-menu-item-client"

export const dynamic = "force-dynamic"

/**
 * One POS item, on a phone — `P.catalogitem.phone()`
 * (`docs/counter/counter-prototype.html:6967`).
 *
 * Awaits its sections for the desk route's reason: the page's own title is the
 * record's name, and a heading cannot stream.
 */
export default async function MobileMenuItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ item: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const { item } = await params
  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") qs.set(key, value)
  }

  const today = new Date()
  const counterParams = readCounterParams(qs, today)

  const sections = await getMenuItemSections({
    slug: item,
    range: counterParams.range,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
  })

  if (isMissing(sections.headline)) notFound()

  return (
    <>
      <CounterPhoneMenuItemClient sections={sections} />
      <span hidden data-perf-ready="/m/menu/catalog/item" />
    </>
  )
}
