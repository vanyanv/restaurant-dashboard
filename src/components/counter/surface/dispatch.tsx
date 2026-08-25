import Link from "next/link"
import { Fragment } from "react"

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
 */

export interface DispatchItem {
  /** `hot` wants a person; `quiet` is a fact. */
  tone: "hot" | "quiet"
  text: string
}

export function Dispatch({
  items,
  action,
}: {
  items: DispatchItem[]
  action?: { label: string; href: string }
}) {
  return (
    <div className="dispatch">
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
