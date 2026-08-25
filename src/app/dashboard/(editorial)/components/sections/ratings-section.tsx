import { getRatingsSummary } from "@/app/actions/ratings/ratings-actions"
import { getStores } from "@/app/actions/store/crud-actions"
import { shortStoreLabels } from "@/lib/dashboard/store-label"
import { RatingsPanel, type RatingsScope } from "../ratings-panel"

/**
 * "What customers said" — the first surface for `OtterRating`, a table that was
 * being written and read by nothing.
 *
 * Scoped by store. `OtterRating` already carries `storeId` and `platform`, so
 * every cut here is a groupBy away; nothing new is stored. Pre-open stores get
 * a real explanation rather than a zero, because a store that has never taken
 * an order has not been rated badly — it has not been rated.
 *
 * Deliberately worst-first and short: a five-star review needs no action, so
 * the section exists to put the handful that do need one in front of the owner
 * alongside the numbers they explain.
 */
export async function RatingsSection() {
  const allStores = await getStores()
  // Trading stores first: `getStores` orders by createdAt, which put both
  // pre-open sites ahead of the only store with reviews in it.
  const stores = [...allStores].sort((a, b) => {
    const aPre = a.lifecycleStage === "pre_open" ? 1 : 0
    const bPre = b.lifecycleStage === "pre_open" ? 1 : 0
    return aPre - bPre || a.name.localeCompare(b.name)
  })
  // "CHRIS N EDDYS - GLENDALE" on every tab spends the width on the one word
  // that is identical across all of them.
  const labels = shortStoreLabels(stores.map((s) => s.name))
  const labelOf = new Map(stores.map((s, i) => [s.id, labels[i]]))
  const ready = stores.filter((s) => s.lifecycleStage !== "pre_open")

  // One call for the blend, one per trading store. Pre-open stores are never
  // queried — there is nothing to find and the tab says so instead.
  const [all, ...perStoreSummaries] = await Promise.all([
    getRatingsSummary(),
    ...ready.map((s) => getRatingsSummary({ storeId: s.id })),
  ])

  // Same contract as the invoice-count and labor-glance readers: a failure or a
  // genuinely empty table renders nothing rather than an empty frame.
  if (!all || all.count === 0) return null

  const serialise = (
    s: NonNullable<Awaited<ReturnType<typeof getRatingsSummary>>>
  ): NonNullable<RatingsScope["summary"]> => ({
    average: s.average,
    count: s.count,
    lowCount: s.lowCount,
    distribution: s.distribution,
    windowDays: s.windowDays,
    stale: s.stale,
    deltaVsPrior: s.deltaVsPrior,
    byPlatform: s.byPlatform,
    recent: s.recent.map((r) => ({
      id: r.id,
      rating: r.rating,
      reviewText: r.reviewText,
      platform: r.platform,
      storeName: r.storeName,
      // Serialised here so the client component never receives a Date across
      // the boundary and never formats one in the browser's timezone.
      reviewedAt: r.reviewedAt.toISOString().slice(0, 10),
      orderItems: r.orderItems,
    })),
  })

  const byStoreId = new Map(
    ready.map((s, i) => [s.id, perStoreSummaries[i] ?? null])
  )

  const scopes: RatingsScope[] = [
    {
      id: "all",
      label: stores.length > 1 ? "All stores" : (labelOf.get(stores[0]?.id ?? "") ?? "All"),
      preOpen: false,
      summary: serialise(all),
      perStore: stores.map((s) => {
        const summary = byStoreId.get(s.id) ?? null
        return {
          id: s.id,
          label: labelOf.get(s.id) ?? s.name,
          preOpen: s.lifecycleStage === "pre_open",
          average: summary?.average ?? null,
          count: summary?.count ?? 0,
        }
      }),
    },
    ...stores.map((s): RatingsScope => {
      const summary = byStoreId.get(s.id) ?? null
      return {
        id: s.id,
        label: labelOf.get(s.id) ?? s.name,
        preOpen: s.lifecycleStage === "pre_open" || summary == null,
        summary: summary ? serialise(summary) : null,
      }
    }),
  ]

  return (
    <div>
      <RatingsPanel scopes={scopes} />
    </div>
  )
}
