import { getServerSession } from "next-auth"
import { AppShell } from "@/components/counter"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { authOptions } from "@/lib/auth"
import { counterToday } from "@/lib/counter/today"

/** `OWNER` -> `Owner`. The rail prints a role, not an enum member. */
function titleCase(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase()
}

/**
 * The Counter chrome, mounted ONCE for every rebuilt desk route.
 *
 * A layout survives a sibling navigation in the App Router; a page does not.
 * `AppShell` — the rail, the topbar, the store switcher and the ⌘K surface —
 * used to be rendered inside each page's client island (4 mount sites, 0
 * layouts), so clicking a rail item destroyed and rebuilt every one of them.
 * Navigation here is genuinely client-side (`Rail` uses `next/link`), which
 * made that rebuild invisible in the network tab and indistinguishable from a
 * browser reload on the screen.
 *
 * ## Why a `(counter)` route group and not `src/app/dashboard/layout.tsx`
 *
 * That layout is shared with the ~19 still-editorial pages under
 * `(editorial)/`, which carry their own chrome — a cream sidebar, a chat
 * drawer, four editorial stylesheets. Mounting the Counter frame there would
 * wrap every one of them in a second shell, which is the doubled-shell defect
 * `src/app/dashboard/layout.tsx`'s own comment records getting fixed. A route
 * group affects no URL — `/dashboard`, `/dashboard/orders`, `/dashboard/pnl`
 * all still resolve from here — and it is the same mechanism the editorial
 * pages already use, read in the other direction: `ls src/app/dashboard/
 * (counter)` is now the list of pages that have been rebuilt.
 *
 * `/dashboard/pnl/[storeId]` deliberately stays OUTSIDE the group. It is a
 * `permanentRedirect` shim onto `/dashboard/pnl?store=<id>` and renders
 * nothing, so wrapping it in a shell would fetch a store list and a session
 * for a 308.
 *
 * ## What is fetched here instead of per page
 *
 * The store list, once. Every page called `getOverviewStores()` for its own
 * copy of the rail's switcher; the ones that still call it need the stores for
 * their own CONTENT (the per-store ledger, the store column), and
 * `getOverviewStores` is `cache()`d so the two calls in one request are one
 * query.
 */
export default async function CounterLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // TOGETHER, not one after the other. Nothing in the shell needs the session
  // to ask for the stores — `getOverviewStores` resolves its own — so awaiting
  // them in sequence made the store query wait out a JWT decrypt for no
  // reason, on the critical path of every desk page's first byte.
  const [session, stores] = await Promise.all([
    getServerSession(authOptions),
    getOverviewStores(),
  ])

  return (
    <AppShell
      stores={stores}
      // The rail's account row. Real session values, not a placeholder — the
      // prototype's "Chris K. / Owner · settings" is the same two facts. A
      // signed-out reader is redirected by the page itself; the shell simply
      // draws no account row rather than inventing one.
      user={
        session
          ? { name: session.user.name, role: titleCase(session.user.role) }
          : undefined
      }
      // Resolved on the server so the shell and the page below it cannot
      // disagree about which calendar day "today" is.
      today={counterToday()}
    >
      {children}
    </AppShell>
  )
}
