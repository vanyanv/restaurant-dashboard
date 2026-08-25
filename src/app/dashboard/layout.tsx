import { getServerSession } from "next-auth"
import { PageViewTracker } from "@/components/telemetry/page-view-tracker"
import { authOptions } from "@/lib/auth"

/**
 * Shared shell for every route under `/dashboard`, Counter and editorial
 * alike. Deliberately thin: everything that used to live here — the cream
 * sidebar, the chat drawer (and its ⌘K listener), the welcome marquee, the
 * editorial stylesheets, Fraunces — moved to `(editorial)/layout.tsx` and
 * now wraps only the ~19 still-editorial pages under that route group. A
 * Counter page composes its own chrome (`AppShell` from
 * `@/components/counter`), so this layout no longer renders any of that
 * for it — that doubled shell (and the ⌘K collision it caused, since the
 * old chat drawer's own listener no longer mounts on Counter routes) is
 * exactly what moving the chrome out of here fixes. See DESIGN.md.
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
