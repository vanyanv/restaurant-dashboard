"use client"

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import Link, { useLinkStatus } from "next/link"
import { signOut } from "next-auth/react"
import { LogOut } from "lucide-react"
import { NAV_GROUPS, isActive, type NavItem } from "@/lib/counter/nav"
import { visibleNavGroups } from "@/lib/counter/nav-access"
import { useReducedMotion } from "@/components/counter/motion/use-reduced-motion"
import { NAV_ICONS } from "./nav-icons"
import { Wordmark } from "./wordmark"
import { StoreSwitcher, type SwitchableStore } from "./store-switcher"

/**
 * `.rail` — the left column: wordmark, store switcher, seventeen destinations
 * in five captioned groups, and the account foot. Ported from `rail()` in the
 * prototype (line ~8232); the destinations themselves are declared once in
 * `@/lib/counter/nav`.
 *
 * Three things the prototype's rail has that this one does not, on purpose:
 *
 *   - `.badge`. The prototype puts a count on a nav item from `p.badge`. No
 *     page declares one, so the rail rendered none — a badge that is always
 *     absent is dead markup; a badge that is invented is a lie. It now has a
 *     source: `needsYou`, the count of open alerts the dashboard layout reads
 *     once per request (`getShellStatus`). Above zero it renders on "Needs
 *     you"; at zero it does not exist. (R3)
 *   - The prototype's `data-goto` buttons are `<Link>`s, so every destination
 *     is a real href: middle-clickable, hoverable for its URL, prefetched.
 *   - `aria-current="page"` from the pathname, not a demo `active` string.
 *
 * ## What moves in the rail, and what does not
 *
 * Chrome is silent on load: nothing here animates when a page arrives. Four
 * things move, each once, each because something happened:
 *
 *   R1  The MARKER travels. One `.rail__marker` sits behind the links and
 *       slides (transform, 220ms) to the current destination instead of the
 *       wash snapping from one item to the next. It is measured from the
 *       active link's offset on every pathname change; under reduced motion
 *       the transition is off and it snaps. The accent bar rides on it.
 *   R2  Pending, honestly. On click the marker moves at once (optimistic —
 *       `chosen`), the destination's icon goes to full ink and the pending
 *       dot breathes until the route lands. If the pathname does not follow
 *       (the navigation failed or was cancelled), `chosen` clears with the
 *       pending state and the marker returns to where the pathname says.
 *   R3  The count on Needs you lands (`ct-land`) and the bell nudges once
 *       when the count RISES after first paint; a falling count only fades.
 *       Only a rising count is news.
 *   R4  The store name cross-fades when the store changes (in
 *       `StoreSwitcher`), and the picker rises in 160ms (the sheet's rule).
 *
 * `RailLinkPending` renders NOTHING once `pending` goes false, rather than an
 * always-present span toggling a class, so a rail with nothing pending (the
 * state every fidelity screenshot measures) comes out byte-identical to a
 * `.navbtn` with no pending child.
 */

export interface RailUser {
  name: string
  role: string
  isDeveloper?: boolean
}

function RailLinkPending({ onSettle }: { onSettle: () => void }) {
  const { pending } = useLinkStatus()
  // When a click's navigation ends without the pathname changing (cancelled,
  // failed, same page), the optimistic marker must give up its guess.
  const was = useRef(pending)
  useEffect(() => {
    if (!(was.current && !pending)) {
      was.current = pending
      return
    }
    was.current = pending
    // A beat later, not now: on a successful navigation the pathname commits
    // right after `pending` drops, and clearing the guess in between would
    // send the marker back to the old item for one frame before the pathname
    // effect moves it forward again. If the pathname has moved by then the
    // guess is already gone; if it has not, the navigation went nowhere.
    const t = setTimeout(onSettle, 300)
    return () => clearTimeout(t)
  }, [pending, onSettle])
  return pending ? <span className="navbtn__pending" aria-hidden="true" /> : null
}

function RailLink({
  item,
  active,
  badge,
  onChoose,
  onSettle,
}: {
  item: NavItem
  active: boolean
  badge?: number
  onChoose: (id: NavItem["id"]) => void
  onSettle: (id: NavItem["id"]) => void
}) {
  const Icon = NAV_ICONS[item.icon]
  const settleThis = useCallback(() => onSettle(item.id), [onSettle, item.id])
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className="navbtn"
      data-nav={item.id}
      onClick={() => onChoose(item.id)}
    >
      {/* The label beside it is the accessible name — an icon announced
          twice (once by name, once by the label) is noise, not help. */}
      {Icon ? <Icon aria-hidden="true" /> : null}
      {item.label}
      {/* The prototype prints the shortcut on Ask alone, and ours is real:
          AskSurface listens for ⌘K from anywhere (note 46). */}
      {item.id === "ask" ? <span className="kb">⌘K</span> : null}
      {badge !== undefined ? <NeedsYouBadge count={badge} /> : null}
      <RailLinkPending onSettle={settleThis} />
    </Link>
  )
}

/**
 * The count on "Needs you". Renders only above zero. A rise after first
 * paint lands the number and rings the bell (`is-rising` on the badge; the
 * sheet reaches the icon through the link); a fall just re-renders, and a
 * fall to zero fades out before the element goes.
 */
function NeedsYouBadge({ count }: { count: number }) {
  const reduced = useReducedMotion()
  const prev = useRef<number | null>(null)
  const [rising, setRising] = useState(false)
  const [shown, setShown] = useState(count)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const was = prev.current
    prev.current = count
    if (was === null) {
      setShown(count)
      return
    }
    if (count > was) {
      setShown(count)
      setLeaving(false)
      if (reduced) return
      setRising(true)
      const t = setTimeout(() => setRising(false), 700)
      return () => clearTimeout(t)
    }
    if (count === 0 && was > 0) {
      if (reduced) {
        setShown(0)
        return
      }
      setLeaving(true)
      const t = setTimeout(() => {
        setLeaving(false)
        setShown(0)
      }, 300)
      return () => clearTimeout(t)
    }
    setShown(count)
  }, [count, reduced])

  if (shown <= 0) return null
  const cls = ["badge", rising ? "is-rising" : null, leaving ? "is-leaving" : null]
    .filter(Boolean)
    .join(" ")
  return (
    <span className={cls} aria-label={`${shown} open`}>
      {shown}
    </span>
  )
}

export function Rail({
  pathname,
  stores,
  selectedStoreId = null,
  onSelectStore,
  user,
  needsYou,
}: {
  pathname: string
  stores?: SwitchableStore[]
  selectedStoreId?: string | null
  onSelectStore?: (id: string | null) => void
  user?: RailUser
  /** Open alerts, from the layout. Undefined renders no badge at all. */
  needsYou?: number
}) {
  const [picking, setPicking] = useState(false)
  const settings = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === "settings")
  const groups = visibleNavGroups(user?.isDeveloper)
  const items = groups.flatMap((g) => g.items)

  // R1/R2: where the marker sits. The pathname decides; a click may guess
  // ahead of it, and the guess is dropped the moment the pathname moves or
  // the pending link settles without it moving.
  const currentId = items.find((i) => isActive(i, pathname))?.id ?? null
  const [chosen, setChosen] = useState<NavItem["id"] | null>(null)
  useEffect(() => {
    setChosen(null)
  }, [pathname])
  // Scoped to the item that settled: a click on A abandoned by a click on B
  // ends A's pending state, and A's settle must not clear B's guess while B
  // is still on its way. Stable, so a re-render inside the 300ms beat does
  // not clear the timer and leave a guess standing.
  const settle = useCallback((id: NavItem["id"]) => setChosen((c) => (c === id ? null : c)), [])
  const markedId = chosen ?? currentId

  const navRef = useRef<HTMLElement>(null)
  const [marker, setMarker] = useState<{ y: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav || !markedId) {
      setMarker(null)
      return
    }
    const place = () => {
      const el = nav.querySelector<HTMLElement>(`[data-nav="${markedId}"]`)
      if (!el) {
        setMarker(null)
        return
      }
      const a = nav.getBoundingClientRect()
      const b = el.getBoundingClientRect()
      setMarker({ y: b.top - a.top + nav.scrollTop, h: b.height })
    }
    place()
    // Fonts landing or the window resizing move every link; follow them.
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null
    ro?.observe(nav)
    return () => ro?.disconnect()
  }, [markedId, groups.length])

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
      <nav aria-label="Sections" ref={navRef} className={marker ? "has-marker" : undefined}>
        {marker ? (
          <span
            className="rail__marker"
            aria-hidden="true"
            style={{ transform: `translateY(${marker.y}px)`, height: marker.h }}
          />
        ) : null}
        {groups.map((group) => (
          <Fragment key={group.caption}>
            <div className="rail__cap">{group.caption}</div>
            <div className="rail__group" role="group" aria-label={group.caption}>
              {group.items.map((item) => (
                <RailLink
                  key={item.id}
                  item={item}
                  active={item.id === currentId}
                  badge={item.id === "needs-you" ? needsYou : undefined}
                  onChoose={setChosen}
                  onSettle={settle}
                />
              ))}
            </div>
          </Fragment>
        ))}
      </nav>

      {user && settings ? (
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
