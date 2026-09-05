import { getServerSession } from "next-auth"
import { PageViewTracker } from "@/components/telemetry/page-view-tracker"
import { authOptions } from "@/lib/auth"

/**
 * Shared shell for every route under `/dashboard`. Deliberately thin, and now
 * thin for good: everything that used to live here — the cream sidebar, the
 * chat drawer (and its ⌘K listener), the welcome marquee, the editorial
 * stylesheets, Fraunces — moved to `(editorial)/layout.tsx`, and on 2026-09-04
 * that layout was DELETED along with the route group it wrapped. A Counter
 * page gets its chrome from `(counter)/layout.tsx`; nothing gets editorial
 * chrome, because there is no longer an editorial page to give it to.
 *
 * What is left directly under this layout is five redirect shims —
 * `chat`, `operations/costs`, `operations/recipes`, `stores/[id]/edit` and
 * `pnl/[storeId]` — whose whole body is one `redirect()`. They render nothing,
 * so they want no shell at all, which is why they sit outside `(counter)`
 * rather than inside it: wrapping a 307 in a rail would fetch a store list and
 * a session to draw a frame nobody sees. See `src/proxy.ts`, which intercepts
 * all five before render.
 *
 * `PageViewTracker` is the one thing this layout does render: pathname-driven
 * telemetry with no styling and no chrome dependency, wanted by every route
 * under `/dashboard` and cheap enough to share.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)
  const trackViews =
    session?.user?.id != null &&
    (session.user.role !== "DEVELOPER" ||
      // Local-only escape hatch; never honoured in production.
      (process.env.TRACK_DEVELOPER_PAGE_VIEWS === "1" &&
        process.env.NODE_ENV !== "production"))

  return (
    <>
      <PageViewTracker enabled={trackViews} />
      {children}
    </>
  )
}
