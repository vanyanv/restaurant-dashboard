/**
 * `.pagehead` — the second of task 5's three structural corrections.
 *
 * The page's title, its subtitle AND the date control live HERE, inside the
 * scrolling screen, not in the topbar. `deskFor()` (prototype line 8715):
 *
 * ```
 * <div class="pagehead">
 *   <div><h2>{title}</h2><p class="sub">{sub}</p></div>
 *   <div class="phactions">{viewTabs}{seg}{CD.bar()}</div>
 * </div>
 * ```
 *
 * Two consequences of moving it, both deliberate:
 *
 *   1. `<h2>`, not `<h1>`. `.pagehead h2` is the selector that sets the display
 *      face, the 22px size and the -.03em tracking (counter-components.css:145);
 *      an `<h1>` gets none of it and renders as unstyled bold text. The heading
 *      LEVEL is not what makes this the page title — `AppShell` names the `main`
 *      landmark with it via `aria-labelledby`, so a screen-reader user still
 *      arrives at "Overview, main".
 *   2. The title is a SENTENCE about the range, not the page's name. The
 *      prototype's `P.overview.title()` returns "7 days to Aug 21" or
 *      "Tuesday's numbers"; the page's name lives in the breadcrumb, which is
 *      where a name belongs. `sub` is the same shape as `R.head()`:
 *      "HOLLYWOOD · AUG 15 – 21, 2026 · VS THE SAME 4 WEEKDAYS" (the uppercase
 *      is `.pagehead .sub`'s `text-transform`, not the caller's).
 *
 * `.phactions` is `margin-left:auto` and wraps, so it is emitted only when
 * there is something to put in it.
 */
import type { ReactNode } from "react"

export function PageHead({
  id,
  title,
  sub,
  children,
}: {
  /** The heading's DOM id, so `main` can be `aria-labelledby` it. */
  id?: string
  title: string
  sub?: string
  /** View tabs, a segmented control, the date control — in that order. */
  children?: ReactNode
}) {
  return (
    /*
     * The entry-animation repair that used to be an inline style HERE now
     * lives in `src/styles/counter-repairs.css`, applied to every
     * `.screen > *` rather than to this one element.
     *
     * Why it moved: the defect is not the pagehead's. A FILLING
     * `transform: none` computes as the identity matrix in Chromium, making
     * every direct child of `.screen` a containing block for `position: fixed`
     * descendants. Measured live — `.dispatch` and all three `.sec` elements
     * trapped a fixed probe at 127/181/352/493px while this element, already
     * repaired, held it at 0. Fixing one element left every section broken and
     * made the next popover someone puts in a section a fresh bug.
     *
     * The replacement is `animation-fill-mode: backwards`, not `none`: these
     * children carry staggered delays, and only `backwards` applies the `from`
     * state during the delay. `none` would flash each section at full opacity
     * before it animated in.
     */
    <div className="pagehead">
      <div>
        <h2 id={id}>{title}</h2>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {children ? <div className="phactions">{children}</div> : null}
    </div>
  )
}
