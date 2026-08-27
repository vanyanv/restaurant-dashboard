import { getServerSession } from "next-auth"
import { PageViewTracker } from "@/components/telemetry/page-view-tracker"
import { authOptions } from "@/lib/auth"

/**
 * Shared shell for every route under `/dashboard`, Counter and editorial
 * alike. Deliberately thin: everything that used to live here — the cream
 * sidebar, the chat drawer (and its ⌘K listener), the welcome marquee, the
 * editorial stylesheets, Fraunces — moved to `(editorial)/layout.tsx` and
 * now wraps only the ~19 still-editorial pages under that route group. A
 * Counter page gets its chrome from `(counter)/layout.tsx` instead, so this
 * layout no longer renders any of that for it — that doubled shell (and the
 * ⌘K collision it caused, since the old chat drawer's own listener no longer
 * mounts on Counter routes) is exactly what moving the chrome out of here
 * fixes. See DESIGN.md.
 *
 * BOTH route groups below it now carry a shell, and that symmetry is the
 * point: `(editorial)/layout.tsx` holds the cream sidebar for the ~19 pages
 * that have not been rebuilt, and `(counter)/layout.tsx` holds the rail, the
 * topbar, the store switcher and the ⌘K surface for the ones that have. The
 * Counter half used to be rendered inside each page's client island — 4 mount
 * sites, 0 layouts — so every navigation between Counter pages destroyed and
 * rebuilt the whole frame. A layout survives a sibling navigation; a page does
 * not. This file stays thin because there is nothing BOTH groups want except
 * the tracker below.
 *
 * `PageViewTracker` stays here rather than moving with the editorial
 * chrome: it's pathname-driven telemetry with no styling and no editorial
 * dependency, so both worlds want it and it costs nothing to share.
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
