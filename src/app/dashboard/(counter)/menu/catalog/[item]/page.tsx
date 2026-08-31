import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getMenuItemSections } from "@/lib/counter/adapters/menu-item"
import { isMissing } from "@/lib/counter/section-data"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterMenuItemClient } from "./counter-menu-item-client"
import { counterToday } from "@/lib/counter/today"

export const dynamic = "force-dynamic"

/**
 * One POS item — `P.catalogitem`
 * (`docs/counter/counter-prototype.html:6930`).
 *
 * ## This route AWAITS its sections, and DESIGN.md exempts it by name
 *
 * The two order-detail routes are the standing exemption from the
 * not-awaited `get*SectionPromises` rule, for the reason that applies here
 * too: the page's own TITLE is the record's name, and a heading cannot stream.
 * Rendering `PageHead` with a placeholder and swapping in the item's name a
 * moment later moves the whole page, and a 404 for an item that never sold has
 * to be decided before anything is sent.
 *
 * The route was `[id]` and took a RECIPE id, so an item with no recipe mapped
 * to it had no page at all — which is exactly the item this page is most
 * useful for. It is keyed by the item's own slug now.
 */
export default async function MenuItemPage({
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

  const today = counterToday()
  const counterParams = readCounterParams(qs, today)
  const input = {
    slug: item,
    range: counterParams.range,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
  }

  const [stores, sections] = await Promise.all([
    getOverviewStores(),
    getMenuItemSections(input),
  ])

  // `isMissing`, not a status comparison: the order-detail route's own way of
  // saying "this record does not exist" without a page branching on a
  // `SectionData` status, which `no-status-branch` forbids and which would put
  // the six-state logic back in a page. An item that did not sell in this
  // window has no page here.
  if (isMissing(sections.headline)) notFound()

  return (
    <>
      <CounterMenuItemClient
        params={qs.toString()}
        stores={stores}
        today={today}
        sections={sections}
      />
      <span hidden data-perf-ready="/dashboard/menu/catalog/item" />
    </>
  )
}
