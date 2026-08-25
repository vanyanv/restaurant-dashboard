import Link from "next/link"
import { NAV_GROUPS, isActive, type NavItem } from "@/lib/counter/nav"
import { SyncChip, type SyncState } from "./sync-chip"

/**
 * The topbar carries THREE things and nothing else — the third of task 5's
 * structural corrections. `deskFor()` (prototype line 8715):
 *
 * ```
 * <div class="topbar">{crumbs}<span class="spacer"></span>{syncChip}
 *   <button class="askbtn" data-cmdopen>Ask the numbers <kbd>⌘K</kbd></button>
 * </div>
 * ```
 *
 * The page title, the subtitle, the store switcher and the date control are
 * all gone from here: the first two are `PageHead`'s, the switcher is the
 * rail's, and the date control is `PageHead`'s `.phactions`.
 *
 * `crumbs()` (prototype line 8213) opens with the STORE, then every step above
 * this page, then the page itself in `<b>`:
 *
 * ```
 * <span class="crumbs">Hollywood<span class="sep">/</span>
 *   <button class="crumb">Invoices</button><span class="sep">/</span>
 *   <b>I28517</b></span>
 * ```
 *
 * Note 48: "the route strings already knew the way."
 * `/dashboard/invoices/I28517` makes Invoices the parent, derived from
 * `pathname` against the same `NAV_GROUPS`/`isActive` the rail uses to light
 * its own current item — so the two can never name a different parent for the
 * same route.
 *
 * The ask button opens the ⌘K surface through the SAME delegated
 * `[data-askabout]` listener every `.askmini` uses (`ask-surface.tsx`), with an
 * empty question: the prototype's `data-cmdopen` opens the palette with nothing
 * typed. One listener, three ways in.
 */

/**
 * The nav destination that owns `pathname` — the same match `Rail` makes when
 * it lights a rail item, reused rather than re-derived.
 */
function owningDestination(pathname: string): NavItem | null {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (isActive(item, pathname)) return item
    }
  }
  return null
}

export function Topbar({
  pathname,
  storeName,
  leaf,
  sync,
}: {
  pathname: string
  /** The store the page is scoped to; the crumb trail starts there. */
  storeName?: string
  /**
   * What this page is called in the trail. Defaults to the owning
   * destination's own label, which is right for a top-level page; a detail
   * route should pass the record's name ("I28517" beats "An invoice").
   */
  leaf?: string
  /** Omitted renders no chip — a dot that means nothing is worse than none. */
  sync?: { state: SyncState; at?: Date; now: Date }
}) {
  const destination = owningDestination(pathname)
  // A crumb only when the route runs deeper than the destination's own href —
  // a top-level page has nothing above it worth naming.
  const crumb = destination && pathname !== destination.href ? destination : null
  const leafText = leaf ?? destination?.label ?? ""

  return (
    <div className="topbar">
      {/* `<nav class="crumbs">` rather than the prototype's `<span>`: it
          computes identically (the class sets `display:flex`) and it is what
          makes the trail a breadcrumb landmark. */}
      <nav aria-label="Breadcrumb" className="crumbs">
        {storeName ? (
          <>
            {storeName}
            <span className="sep" aria-hidden="true">
              /
            </span>
          </>
        ) : null}
        {crumb ? (
          <>
            <Link className="crumb" href={crumb.href}>
              {crumb.label}
            </Link>
            <span className="sep" aria-hidden="true">
              /
            </span>
          </>
        ) : null}
        <b>{leafText}</b>
      </nav>

      <span className="spacer" />

      {sync ? <SyncChip state={sync.state} at={sync.at} now={sync.now} /> : null}

      <button className="askbtn" type="button" data-askabout="">
        Ask the numbers <kbd>⌘K</kbd>
      </button>
    </div>
  )
}
