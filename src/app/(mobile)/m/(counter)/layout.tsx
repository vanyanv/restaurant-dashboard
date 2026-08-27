import { PhoneShell } from "@/components/counter"
import { getOverviewStores } from "@/lib/counter/adapters/overview"

/**
 * The Counter chrome on the phone, mounted ONCE for every rebuilt `/m` route.
 *
 * Same defect as the desk's and the same fix: `.ct-root.ct-phone` + `.mtop` +
 * `.mscroll` opened every phone Counter island, so a tab change destroyed and
 * rebuilt the top chrome, its store sheet and its date sheet. `PhoneShell`
 * lives here instead.
 *
 * ## Why a `(counter)` route group and not `src/app/(mobile)/m/layout.tsx`
 *
 * `counter-phone-overview-client.tsx` wrote the answer down before this
 * existed: "`.mtop` is rendered inside this island rather than in
 * `(mobile)/m/layout.tsx`: its rules read `--chrome` and `--line`, which only
 * resolve under a Counter root, and that layout is shared with a dozen
 * editorial `/m` pages that have their own toolbar. It moves to the shell the
 * day the shell is Counter." A `(counter)` group is that shell — it wraps the
 * four rebuilt routes (`/m`, `/m/orders`, `/m/orders/<id>`, `/m/pnl`) and
 * nothing else, and it changes no URL.
 *
 * `/m/pnl/[storeId]` stays outside it: that page is still editorial.
 *
 * ## No session gate here
 *
 * Each page carries its own, and `getOverviewStores` is scoped to the session
 * and fails closed to `[]` — so an unauthenticated request draws a store
 * switcher with nothing in it for the instant before the page redirects,
 * rather than a second copy of an authorisation decision that could drift from
 * the pages'.
 */
export default async function CounterPhoneLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const stores = await getOverviewStores()

  return (
    <PhoneShell stores={stores} today={new Date()}>
      {children}
    </PhoneShell>
  )
}
