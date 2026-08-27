"use client"

import { Fragment, useState } from "react"
import Link, { useLinkStatus } from "next/link"
import { NAV_GROUPS, isActive, type NavItem } from "@/lib/counter/nav"
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
 *   - `.rail__logo`'s `<img class="logo">`. We have no logo asset; `Wordmark`
 *     is the same thing set in type (note 15: "the wordmark is the palette's
 *     alibi"). `.rail__logo`'s own padding still applies.
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
      <nav aria-label="Sections">
        {NAV_GROUPS.map((group) => (
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
        <Link className="rail__foot" href={settings.href}>
          <span className="avatar" aria-hidden="true">
            {user.name.trim().charAt(0).toUpperCase()}
          </span>
          <span>
            <span className="nm">{user.name}</span>
            <span className="rl">{user.role} · settings</span>
          </span>
        </Link>
      ) : null}
    </aside>
  )
}
