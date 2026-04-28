import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { loadPageData } from "@/lib/ai-analytics/read"
import { loadOverviewSourceData } from "@/lib/ai-analytics/routes/overview"
import { EditorialTopbar } from "../components/editorial-topbar"
import { AiPageFrame } from "./components/shared/ai-page-frame"
import { RouteNav } from "./components/shared/route-nav"
import { StoreScopeSelector } from "./components/shared/store-scope-selector"
import { LastUpdatedStamp } from "./components/shared/last-updated-stamp"
import { InsightList } from "./components/shared/insight-list"
import { EmptyEdition } from "./components/shared/empty-edition"
import { LeadBriefing } from "./components/overview/lead-briefing"
import { KpiStrip } from "./components/overview/kpi-strip"
import { PerStoreStrip } from "./components/overview/per-store-strip"

interface AiAnalyticsOverviewPageProps {
  searchParams: Promise<{ store?: string }>
}

export default async function AiAnalyticsOverviewPage({
  searchParams,
}: AiAnalyticsOverviewPageProps) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/dashboard")

  const { store: storeParam } = await searchParams
  const stores = await prisma.store.findMany({
    where: { ownerId: session.user.id, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  const requestedStoreId =
    storeParam && stores.some((s) => s.id === storeParam) ? storeParam : null
  const scope = requestedStoreId ? "STORE" : "ALL"

  const [pageData, sourceData] = await Promise.all([
    loadPageData({
      route: "OVERVIEW",
      scope,
      storeId: requestedStoreId,
    }),
    loadOverviewSourceData(requestedStoreId, session.user.id),
  ])

  const lead = pageData.insights[0] ?? null
  const remaining = pageData.insights.slice(1)

  return (
    <AiPageFrame
      topbar={
        <EditorialTopbar section="§ AI" title="Analytics">
          <StoreScopeSelector stores={stores} value={requestedStoreId} />
        </EditorialTopbar>
      }
      routeNav={<RouteNav />}
      lastUpdated={
        <LastUpdatedStamp
          generatedAt={pageData.latestRun?.generatedAt ?? null}
          status={pageData.latestRun?.status ?? null}
          stale={pageData.lastRunFailed}
        />
      }
    >
      <KpiStrip kpis={sourceData.kpis} />

      {pageData.latestRun ? (
        <>
          {lead ? <LeadBriefing insight={lead} /> : null}

          {remaining.length > 0 ? (
            <section className="space-y-4">
              <header className="flex items-baseline justify-between">
                <h2 className="font-display text-[20px] italic text-(--ink)">
                  What to act on today
                </h2>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
                  Ranked by severity
                </span>
              </header>
              <InsightList insights={remaining} startAt={1} />
            </section>
          ) : null}
        </>
      ) : (
        <EmptyEdition cadence="every hour at :45 past" />
      )}

      {sourceData.scope === "ALL" && sourceData.perStore ? (
        <PerStoreStrip perStore={sourceData.perStore} />
      ) : null}
    </AiPageFrame>
  )
}
