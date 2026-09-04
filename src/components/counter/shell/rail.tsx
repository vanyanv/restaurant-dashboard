"use client"

import { Fragment, useState } from "react"
import Link, { useLinkStatus } from "next/link"
import { signOut } from "next-auth/react"
import { LogOut } from "lucide-react"
import { NAV_GROUPS, isActive, type NavItem } from "@/lib/counter/nav"
import { visibleNavGroups } from "@/lib/counter/nav-access"
import { NAV_ICONS } from "./nav-icons"
import { Wordmark } from "./wordmark"
import { StoreSwitcher, type SwitchableStore } from "./store-switcher"

/**
 * The rail, as the prototype builds it (`rail()`, line 8231):
 *
 * ```
 * <aside class="rail">
 *   <div class="rail__logo">…
 *   <div style="position:relative;padding:0 10px">   ← THE STORE SWITCHER
 *   <div>  .rail__cap / .rail__group / .navbtn  × 5 groups
 *   <button class="rail__foot"> .avatar + name + role
 * </aside>
 * ```
 *
 * The store switcher belongs HERE, not in the topbar — that is the first of
 * task 5's three structural corrections. Its open state is a class on this
 * element (`.rail.is-picking .storepop{display:block}`,
 * counter-components.css:743), which is why the state lives in the rail and
 * `StoreSwitcher` is controlled.
 *
 * WHAT IS NOT PORTED, AND WHY:
 *
 *   - `.badge`. The prototype puts a count on a nav item from `p.badge`. No
 *     destination in `src/lib/counter/nav.ts` has a count behind it yet, and a
 *     badge that is always absent is dead markup; a badge that is invented is
 *     worse. It comes back with the data.
 *   - `.rail__logo`'s `<img class="logo">`. `Wordmark` draws the name in type
 *     instead, and the reason given here — "we have no logo asset" — was
 *     never true: `public/logo.png` has been in the tree since the first
 *     commit, and the auth screens now draw it through `shell/logo.tsx`. The
 *     rail is the last slot still set in type, and swapping it is a change to
 *     the chrome of every desk page rather than one screen, so it is being
 *     left for a deliberate pass rather than carried in on the back of the
 *     sign-in fix. Note 15 ("the wordmark is the palette's alibi") argues FOR
 *     the mark here, not against it. `.rail__logo`'s own padding applies
 *     either way.
 *   - `<nav>` in place of the prototype's unclassed wrapper `<div>` around the
 *     groups. A `<nav>` computes identically to a `<div>` and is what makes the
 *     five groups a navigation landmark; the rail as a whole is now more than
 *     navigation (a store control and an account row live in it), so the
 *     landmark is scoped to the part that navigates.
 *
 * `.navbtn` is a `<Link>` rather than the prototype's `<button data-goto>`: a
 * destination that is a real href is middle-clickable and openable in a new
 * tab, and the ported rules (`.navbtn`, `.navbtn[aria-current="page"]`, the
 * accent bar in `::before`) are all class- and attribute-keyed, so they apply
 * to an `<a>` unchanged.
 *
 * ## Prefetch (streaming-architecture plan, task 5)
 *
 * No `prefetch` prop is set on any `<Link>` below, and that is deliberate
 * rather than an oversight: the default is `"auto"`, which prefetches a
 * static route in full and a DYNAMIC route down to its nearest `loading.tsx`
 * on viewport entry and hover. Every Counter route this rail can link to
 * already has a `loading.tsx` (Task 2), so hovering an item already warms its
 * destination's shell with no code here to add. Setting `prefetch={true}`
 * would force the FULL dynamic response to prefetch on hover — every
 * section's data, for every item a reader's mouse merely crosses — which is
 * the opposite of the per-section isolation Task 3 exists for.
 */

export interface RailUser {
  name: string
  /** "Owner", "Developer" — printed under the name, beside "settings". */
  role: string
  /**
   * Whether this account may open `/dashboard/admin/**`. A PERMISSION, not the
   * label above: `role` is title-cased for display, and deciding what a reader
   * can reach by matching a display string is how a rename becomes a security
   * change.
   *
   * Optional, and absent means NO. A rail with no account row cannot know who
   * is reading, and the safe answer to "should I offer this link" when you do
   * not know is not to.
   */
  isDeveloper?: boolean
}

/**
 * Task 5's third change: Next 16's `useLinkStatus` — readable only from a
 * descendant of the `<Link>` it reports on, which is why this is a child
 * component rather than a hook call inside `RailLink` itself.
 *
 * Renders NOTHING once `pending` goes false, rather than an always-present
 * element toggled by a class: the settled DOM (the state `npm run fidelity`
 * measures) must come out byte-identical to a `.navbtn` with no pending
 * feedback at all, and `null` is the only value that guarantees that. The dot
 * only exists for the moment between a click and the destination's own
 * paint — after prefetch, `useLinkStatus`'s own docs say that moment is often
 * skipped entirely.
 */
function RailLinkPending() {
  const { pending } = useLinkStatus()
  return pending ? <span className="navbtn__pending" aria-hidden="true" /> : null
}

function RailLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(item, pathname)
  const Icon = NAV_ICONS[item.icon]
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className="navbtn">
      {/* The label beside it is the accessible name — an icon announced
          twice (once by name, once by the label) is noise, not help. */}
      {Icon ? <Icon aria-hidden="true" /> : null}
      {item.label}
      {/* The prototype prints the shortcut on Ask alone, and ours is real:
          AskSurface listens for ⌘K from anywhere (note 46). */}
      {item.id === "ask" ? <span className="kb">⌘K</span> : null}
      <RailLinkPending />
    </Link>
  )
}

export function Rail({
  pathname,
  stores,
  selectedStoreId = null,
  onSelectStore,
  user,
}: {
  pathname: string
  /** Omitted (or empty) renders no store control at all, rather than an empty one. */
  stores?: SwitchableStore[]
  selectedStoreId?: string | null
  onSelectStore?: (id: string | null) => void
  user?: RailUser
}) {
  const [picking, setPicking] = useState(false)
  const settings = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === "settings")

  return (
    <aside className={picking ? "rail is-picking" : "rail"}>
      <div className="rail__logo">
        <Wordmark />
      </div>

      {stores && stores.length > 0 && onSelectStore ? (
        <StoreSwitcher
          stores={stores}
          selectedId={selectedStoreId}
          onSelect={onSelectStore}
          open={picking}
          onOpenChange={setPicking}
        />
      ) : null}

      {/* A Fragment per group, not a wrapper <div>: the prototype emits the
          caption and the group as SIBLINGS inside one unclassed container, and
          a per-group box would be a fourth element in a stylesheet that has
          rules for three. */}
      {/* `visibleNavGroups`, not `NAV_GROUPS`: the ⌘K palette draws from the
          same helper, so the rail and the palette cannot offer different sets
          of destinations to the same reader. See `nav-access.ts`. */}
      <nav aria-label="Sections">
        {visibleNavGroups(user?.isDeveloper).map((group) => (
          <Fragment key={group.caption}>
            <div className="rail__cap">{group.caption}</div>
            <div className="rail__group" role="group" aria-label={group.caption}>
              {group.items.map((item) => (
                <RailLink key={item.id} item={item} pathname={pathname} />
              ))}
            </div>
          </Fragment>
        ))}
      </nav>

      {user && settings ? (
        /*
         * The account row EXACTLY as the prototype draws it (`rail()`, line
         * 8259: avatar, `.nm`, and an `.rl` reading "Owner · settings"), and
         * then the thing the prototype has nowhere on the desk.
         *
         * There was no way to sign out of a Counter desk page. Not here, not
         * on Settings, not anywhere: `signOut` was called from exactly two
         * places in `src/` — the phone's More tab and `app-sidebar.tsx`, which
         * renders only on the four routes still left in `(editorial)`. That is
         * 48 of the 52 desk pages with no exit.
         *
         * It went missing by inheritance rather than by decision. The
         * prototype's desk puts its only two sign-out controls in `P.settings`'
         * Sessions panel — "End" and "Sign out everywhere" — and the fidelity
         * manifest declares both absent, correctly: auth is `strategy: "jwt"`
         * with no session table, so there is nothing to enumerate and nothing
         * to revoke on a device this browser is not. What that argument does
         * NOT cover is signing out of THIS browser, which is a cookie and no
         * session table at all — which is exactly why the phone's button has
         * always worked. The absence was one button too wide, and the desk had
         * no others.
         *
         * A LABELLED ROW OF ITS OWN, not an icon in the account row and not a
         * menu behind it. Both of those were tried. An icon beside the name
         * takes ~35px out of a 194px row and wraps the design's own
         * "DEVELOPER · SETTINGS" onto two lines; a menu hides the control
         * whose absence is the bug being fixed. `.navbtn` is the rail's
         * existing row idiom, seventeen of them are already stacked above it,
         * and a reader looking for "Sign out" finds the words.
         *
         * `next-auth/react` is a client import and this shell is on all 48
         * routes, so it costs bytes there. It is the same call the phone's More
         * tab and `app-sidebar.tsx` already make, and the alternative — posting
         * to `/api/auth/signout` by hand — means re-deriving the CSRF token and
         * the environment-dependent cookie name that next-auth already knows.
         */
        <>
          <Link className="rail__foot" href={settings.href}>
            <span className="avatar" aria-hidden="true">
              {user.name.trim().charAt(0).toUpperCase()}
            </span>
            <span>
              <span className="nm">{user.name}</span>
              <span className="rl">{user.role} · settings</span>
            </span>
          </Link>
          <button
            className="navbtn rail__signout"
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut aria-hidden="true" />
            Sign out
          </button>
        </>
      ) : null}
    </aside>
  )
}
