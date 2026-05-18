import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getOpportunities } from "@/app/actions/growth/opportunities-actions"
import { OpportunityRow } from "./components/opportunity-row"
import { OpportunitiesEmptyState } from "./components/opportunities-empty-state"

export default async function OpportunitiesPage(props: {
  searchParams: Promise<{ storeId?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  // OWNER users land on /dashboard/decisions; this page is now DEVELOPER-only.
  if (session.user.role !== "DEVELOPER") redirect("/dashboard/decisions")
  const { storeId } = await props.searchParams
  const result = await getOpportunities({ storeId })
  if (!result || !result.ok) {
    return (
      <div className="px-6 py-6 text-[color:var(--ink-muted)]">
        Unable to load opportunities for this store.
      </div>
    )
  }
  if (result.opportunities.length === 0) {
    return <OpportunitiesEmptyState lifecycleStage={result.lifecycleStage} storeName={result.storeName} />
  }
  return (
    <section className="inv-panel mx-6 my-6">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">Opportunities · {result.storeName}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">
          as of {result.asOfDate?.toISOString().slice(0, 10)}
        </span>
      </header>
      <ol>
        {result.opportunities.map((o) => (
          <OpportunityRow key={o.id} opportunity={o} />
        ))}
      </ol>
    </section>
  )
}
