"use client"

import Link from "next/link"
import { Fragment } from "react"
import { useFreshKeys } from "@/components/counter/motion/use-fresh-keys"

/**
 * `.dispatch` — the masthead dispatch line, emitted inline inside
 * `P.overview.desk()` (prototype line 4231). Its own note: "needs-you,
 * trading, and whether the figures can be trusted, in one line."
 *
 * ```
 * <div class="dispatch">
 *   <span class="hot">3 need you</span><span class="sep">·</span>
 *   <span class="quiet">1,284 orders trading</span><span class="sep">·</span>
 *   <span class="quiet">synced 12 min ago</span>
 *   <span class="spacer"></span>
 *   <button class="go" data-goto="alerts">Open the queue</button>
 * </div>
 * ```
 *
 * It belongs to the PAGE, not the shell — it is the first thing inside the
 * screen, above the head block, and each page decides what its own three facts
 * are. Two tones: `.hot` is the accent, with a pulsing dot in `::before`, and
 * is for something that wants a person; `.quiet` is ink-2 and is for something
 * that is merely true. A line of all-`hot` items says nothing, so a caller that
 * marks everything urgent has marked nothing.
 *
 * `.go` is a `<Link>` rather than the prototype's `<button data-goto>`, for the
 * same reason `.navbtn` is: a real href is middle-clickable. It renders only
 * when there is somewhere to go — a button that does nothing is worse than no
 * button.
 *
 * Motion (tier 2, D4): a `hot` fact whose text changed AFTER first paint — the
 * count of what needs the reader went up while the page was open — rings the
 * whole line once: `is-ringing`, the bad cool-down from counter-repairs.css.
 * `useFreshKeys` is what knows "after first paint", and `scope` (the store and
 * range the page is showing) is what stops the reader's own range change from
 * ringing. Each fact is keyed on its text, so a changed fact remounts and
 * fades in under the generated sheet's own entry rule rather than snapping.
 */

export interface DispatchItem {
  /** `hot` wants a person; `quiet` is a fact. */
  tone: "hot" | "quiet"
  text: string
}

export function Dispatch({
  items,
  action,
  scope = "",
}: {
  items: DispatchItem[]
  action?: { label: string; href: string }
  /** Names the reader's own act (store + range); a change inside it never rings. */
  scope?: string
}) {
  const fresh = useFreshKeys(
    items.filter((i) => i.tone === "hot").map((i) => i.text),
    scope,
  )
  return (
    <div className={fresh.size > 0 ? "dispatch is-ringing" : "dispatch"}>
      {items.map((item, i) => (
        <Fragment key={`${item.tone}-${item.text}`}>
          {i > 0 ? (
            <span className="sep" aria-hidden="true">
              ·
            </span>
          ) : null}
          <span className={item.tone}>{item.text}</span>
        </Fragment>
      ))}
      <span className="spacer" />
      {action ? (
        <Link className="go" href={action.href}>
          {action.label}
        </Link>
      ) : null}
    </div>
  )
}
