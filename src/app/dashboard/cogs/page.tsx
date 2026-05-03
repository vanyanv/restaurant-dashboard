import Link from "next/link"
import { redirect } from "next/navigation"
import { startOfDay, subDays } from "date-fns"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getCogsStoreOverview } from "@/lib/cogs"
import { EditorialTopbar } from "../components/editorial-topbar"

function formatMoney(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

function formatPct(value: number | null): string {
  if (value == null) return "set"
  return `${value.toFixed(1)}%`
}

function formatDelta(value: number | null): string {
  if (value == null) return "no target"
  if (value > 0) return `+${value.toFixed(1)}pp`
  if (value < 0) return `${value.toFixed(1)}pp`
  return "flat"
}

export default async function CogsLandingPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard")

  const today = startOfDay(new Date())
  const startDate = subDays(today, 29)
  const endDate = new Date(today.getTime() + 24 * 60 * 60 * 1000)
  const stores = await getCogsStoreOverview(
    session.user.accountId,
    startDate,
    endDate
  )

  if (stores.length === 1) redirect(`/dashboard/cogs/${stores[0].storeId}`)

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar section="§ 13" title="COGS" />
      <div className="flex-1 overflow-auto px-4 pb-8 pt-4 sm:px-6 sm:pt-5">
        <div className="cogs-page flex flex-col gap-6">
          <section className="inv-panel inv-panel--flush dock-in dock-in-1">
            <div className="inv-panel__head cogs-store-overview__head">
              <div>
                <span className="inv-panel__dept">Last 30 days</span>
                <h1 className="inv-panel__title">Store COGS watchlist</h1>
              </div>
              <span className="cogs-store-overview__scope">
                ranked by target miss, data risk, then dollars
              </span>
            </div>

            {stores.length === 0 ? (
              <div className="cogs-empty-note">
                No active stores. Create a store before reviewing COGS.
              </div>
            ) : (
              <div className="cogs-store-ledger" role="table" aria-label="COGS by store">
                <div className="cogs-store-ledger__row cogs-store-ledger__row--head" role="row">
                  <span role="columnheader">Store</span>
                  <span role="columnheader">COGS %</span>
                  <span role="columnheader">Target</span>
                  <span role="columnheader">Delta</span>
                  <span role="columnheader">COGS</span>
                  <span role="columnheader">Food</span>
                  <span role="columnheader">Revenue</span>
                  <span role="columnheader">Risk</span>
                </div>
                {stores.map((store) => {
                  const overTarget =
                    store.deltaVsTargetPp != null && store.deltaVsTargetPp > 0
                  return (
                    <Link
                      key={store.storeId}
                      href={`/dashboard/cogs/${store.storeId}`}
                      className={
                        overTarget
                          ? "cogs-store-ledger__row cogs-store-ledger__row--link cogs-store-ledger__row--over"
                          : "cogs-store-ledger__row cogs-store-ledger__row--link"
                      }
                      role="row"
                    >
                      <span className="cogs-store-ledger__name" role="cell">
                        {store.storeName}
                      </span>
                      <span role="cell">{formatPct(store.cogsPct)}</span>
                      <span role="cell">{formatPct(store.targetCogsPct)}</span>
                      <span role="cell">{formatDelta(store.deltaVsTargetPp)}</span>
                      <span role="cell">{formatMoney(store.cogsDollars)}</span>
                      <span role="cell">{formatMoney(store.foodCogsDollars)}</span>
                      <span role="cell">{formatMoney(store.revenueDollars)}</span>
                      <span role="cell">
                        {store.warningCount === 0 ? "clean" : store.warningCount}
                      </span>
                    </Link>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
