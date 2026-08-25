import Link from "next/link"
import { NAV_GROUPS, isActive, type NavItem } from "@/lib/counter/nav"
import type { ReactNode } from "react"

/**
 * The header every Counter page sits under, inside `AppShell`'s topbar slot.
 *
 * Note 48: "the route strings already knew the way." `/dashboard/invoices/I28517`
 * makes Invoices the parent — of the breadcrumb here AND the phone's back
 * button — and nothing about that is hand-wired. The breadcrumb is derived
 * from `pathname` against the same `NAV_GROUPS` / `isActive` the rail uses to
 * light its own current item, so the two can never name a different parent
 * for the same route. A page passing its own `parent` prop is exactly the
 * bug note 48 describes: fourteen detail pages went unreachable in the
 * prototype when a hand-wired parent drifted from the rail's own idea of the
 * hierarchy.
 */

/**
 * The nav destination that owns `pathname` — the same match `Rail` makes
 * when it lights a rail item, reused rather than re-derived so the two can
 * never disagree about which destination a route belongs to.
 */
function owningDestination(pathname: string): NavItem | null {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (isActive(item, pathname)) return item
    }
  }
  return null
}

function formatSyncedAt(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

export function Topbar({
  pathname,
  title,
  syncedAt,
  children,
}: {
  pathname: string
  title: string
  syncedAt?: Date
  children?: ReactNode
}) {
  const destination = owningDestination(pathname)
  // A crumb only when the route runs deeper than the destination's own
  // href — a top-level page (pathname === destination.href) has nothing
  // above it worth naming.
  const crumb = destination && pathname !== destination.href ? destination : null

  return (
    <header className="flex items-center gap-4 border-b border-ct-line bg-ct-chrome px-4 py-2.5">
      <div className="min-w-0 flex-1">
        {crumb && (
          <nav
            aria-label="Breadcrumb"
            className="mb-0.5 flex items-center gap-1.5 font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3"
          >
            <Link href={crumb.href} className="hover:text-ct-accent">
              {crumb.label}
            </Link>
            <span aria-hidden="true" className="opacity-60">
              /
            </span>
            <span className="truncate text-ct-ink-2">{title}</span>
          </nav>
        )}
        <h1 className="truncate font-ct-display text-ct-lg font-bold text-ct-ink">
          {title}
        </h1>
      </div>

      {syncedAt && (
        <p className="flex items-center gap-1.5 whitespace-nowrap font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-ct-good" />
          Synced {formatSyncedAt(syncedAt)}
        </p>
      )}

      {children && <div className="flex items-center gap-2">{children}</div>}
    </header>
  )
}
