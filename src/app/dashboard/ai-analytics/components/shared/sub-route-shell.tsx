import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { loadPageData } from "@/lib/ai-analytics/read"
import type { AiAnalyticsRoute } from "@/generated/prisma/client"
import { EditorialTopbar } from "../../../components/editorial-topbar"
import { AiPageFrame } from "./ai-page-frame"
import { RouteNav } from "./route-nav"
import { StoreScopeSelector } from "./store-scope-selector"
import { LastUpdatedStamp } from "./last-updated-stamp"
import { InsightList } from "./insight-list"
import { EmptyEdition } from "./empty-edition"

interface SubRouteShellProps {
  route: AiAnalyticsRoute
  pageTitle: string
  cadenceCopy: string
  /** Optional route-specific data section rendered above the insight list
   * (e.g. a small KPI strip computed from the same source data the cron used). */
  dataSection?: (args: {
    storeId: string | null
    ownerId: string
  }) => Promise<ReactNode>
  searchParams: Promise<{ store?: string }>
}

/**
 * Shared shell for the four sub-routes (Sales, Menu, COGS, Invoices). Loads
 * insights for the user's current scope and renders them as a numbered list.
 * Each route page is a thin wrapper that supplies its title and (optional)
 * data section.
 */
export async function SubRouteShell({
  route,
  pageTitle,
  cadenceCopy,
  dataSection,
  searchParams,
}: SubRouteShellProps) {
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

  const pageData = await loadPageData({
    route,
    scope,
    storeId: requestedStoreId,
  })

  const dataNode = dataSection
    ? await dataSection({ storeId: requestedStoreId, ownerId: session.user.id })
    : null

  return (
    <AiPageFrame
      topbar={
        <EditorialTopbar section="§ AI" title={pageTitle}>
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
      {dataNode}

      {pageData.latestRun ? (
        <section className="space-y-4">
          <header className="flex items-baseline justify-between">
            <h2 className="font-display text-[20px] italic text-(--ink)">
              What to act on
            </h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
              Ranked by severity
            </span>
          </header>
          <InsightList insights={pageData.insights} />
        </section>
      ) : (
        <EmptyEdition cadence={cadenceCopy} />
      )}
    </AiPageFrame>
  )
}
