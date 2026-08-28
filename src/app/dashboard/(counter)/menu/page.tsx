import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getMenuHubSectionPromises } from "@/lib/counter/adapters/menu-hub"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { rangeLabel } from "@/lib/counter/date-range"
import { CounterMenuClient } from "./counter-menu-client"

/**
 * The Menu hub — `P.menuhub` (`docs/counter/counter-prototype.html:7274`).
 *
 * The rail's Menu item points here, and the page's whole job is to say what the
 * menu IS and hand the reader to one of the three places it is worked on. Four
 * figures, three destinations, one ring.
 *
 * ## No owner gate, and that is deliberate
 *
 * Every other Counter money page redirects a non-owner, because every section
 * on it is a dollar figure the rollup refuses to serve. This page counts items,
 * categories and mapping gaps — the only money on it is one blended margin, and
 * a reader who cannot see that can still use the other three cells and all
 * three links. Gating the page for one cell would be the Analytics judgement in
 * reverse.
 *
 * A page resolves the session, reads the URL params ONCE, calls exactly one
 * adapter and hands plain serialisable props to a client island. It never
 * imports Prisma or an action directly and never inspects `SectionData.status`.
 */
export default async function MenuPage({
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

  const today = new Date()
  const counterParams = readCounterParams(params, today)

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section`. The three destinations resolve instantly
  // and do not wait on the counts: a reader whose figures failed to load can
  // still open the catalog, which is the point of the section.
  const sections = getMenuHubSectionPromises(
    {
      range: counterParams.range,
      storeId: counterParams.storeId,
      accountId: session.user.accountId,
    },
    rangeLabel(counterParams.range, counterParams.presetId),
  )

  const stores = await getOverviewStores()

  return (
    <CounterMenuClient
      params={params.toString()}
      stores={stores}
      today={today}
      sections={sections}
    />
  )
}
