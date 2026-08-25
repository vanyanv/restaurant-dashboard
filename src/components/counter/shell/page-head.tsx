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
     * `animationFillMode: "none"` is a REPAIR, not a style, and it is the only
     * inline style in this component. Measured, in Chromium, on the prototype
     * itself as well as on us:
     *
     *   `.screen > *{animation:cnter .34s … both}` (counter-components.css:780)
     *   ends on `@keyframes cnter{to{…transform:none}}`. With `fill-mode: both`
     *   that `to` state is applied FOREVER after the 340ms, and Chromium
     *   computes a filled `transform:none` as `matrix(1, 0, 0, 1, 0, 0)` — the
     *   identity matrix, which is "a value other than none". So `.pagehead`
     *   becomes, permanently: (1) a STACKING CONTEXT, which traps
     *   `.drpop{z-index:60}` inside it, so every later `.sec` sibling paints
     *   OVER the open date popover; and (2) a CONTAINING BLOCK for fixed
     *   positioning, so below 640px — where the sheet turns `.drpop` into
     *   `position:fixed;left:10;right:10;bottom:10` — the sheet anchors to the
     *   page head instead of the viewport and lands 295px above its top.
     *
     *   Verified on `docs/counter/counter-prototype.html` at 1440×900:
     *   `document.elementFromPoint()` at the open popover's own centre returns
     *   a `<p>` that is NOT inside the popover. The design has this bug; we
     *   inherited it by being faithful.
     *
     * Why THIS repair and not a z-index: `.pagehead` is `.screen`'s first child,
     * so `.screen > *:nth-child(1)` gives it `animation-delay: 0ms` — which
     * means `fill-mode`'s BACKWARDS half never applies to it — and `cnter`'s
     * `to` state (`opacity:1; transform:none`) is exactly this element's
     * default state, so dropping the FORWARDS half changes nothing that is
     * drawn. The entry animation still runs. Only the permanent identity
     * matrix goes, and both symptoms go with it. A z-index would have fixed
     * the painting and left the 390px sheet where it was.
     *
     * This does not belong in a stylesheet: `counter-components.css` is
     * GENERATED from the prototype by `scripts/extract-prototype-css.ts`, and
     * hand-editing it would be overwritten by the next `npm run css:extract`.
     */
    <div className="pagehead" style={{ animationFillMode: "none" }}>
      <div>
        <h2 id={id}>{title}</h2>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {children ? <div className="phactions">{children}</div> : null}
    </div>
  )
}
