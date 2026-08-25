"use client"

import { useId, useState, type ReactNode } from "react"
import { Caret } from "./caret"

/**
 * A drill-down lives UNDER the mark it explains, not beside it as a peer.
 *
 * Ported from `drill()` at line 3888 of `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="drill drill--wide">
 *   <button class="drill__t" type="button" aria-expanded="false">
 *     <span class="car">…chev…</span>Every figure against the same 4 weekdays
 *   </button>
 *   <div class="ldrawer"><div class="lpanel">…</div></div>
 * </div>
 * ```
 *
 * `.drill > .ldrawer` is `display:none` until `.is-open` is added
 * (counter-components.css:1096-1097), and `.drill__t[aria-expanded="true"] .car`
 * is what rotates the chevron — so the attribute is load-bearing, not
 * decoration, exactly as it is on `.storeopt`'s `aria-pressed`.
 *
 * ## What this adds to the prototype, and why
 *
 * `aria-controls` on the toggle, and an `id` on the panel it names. The
 * prototype wires its drawers through a `data-lex` / `data-ldrawer` pair read
 * by one delegated listener — a mechanism, not an announcement, and a screen
 * reader gets nothing from it. A disclosure that says `aria-expanded` without
 * saying WHAT it expanded makes the user hunt for the panel. `useId` supplies
 * the id so two drills on one page cannot collide.
 *
 * The panel stays MOUNTED when closed (the sheet hides it with `display:none`)
 * rather than being conditionally rendered, because `aria-controls` must point
 * at an element that exists, and because a table inside a closed drawer keeps
 * its scroll position across a toggle.
 *
 * ## Uncontrolled on purpose
 *
 * The prototype's drill owns its own open state and nothing else on the page
 * reads it. Lifting it into a prop would make every caller carry a `useState`
 * for a disclosure that has no other consumer. `StoreCards` is the opposite
 * case — three cards share one "only one open" rule — and manages its own.
 */
export function Drill({
  label,
  children,
  wide,
  defaultOpen = false,
}: {
  /** The toggle's text. Sits after the chevron. */
  label: ReactNode
  children: ReactNode
  /**
   * `.drill--wide`: a bordered box at the page's full width rather than a rule
   * under the mark above. The prototype uses it for the comparison table,
   * because a four-column table in a 340px column wraps every row it has.
   */
  wide?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = `drill-${useId()}`

  return (
    <div className={wide ? "drill drill--wide" : "drill"}>
      <button
        className="drill__t"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <Caret />
        {label}
      </button>
      <div className={open ? "ldrawer is-open" : "ldrawer"} id={panelId}>
        <div className="lpanel">{children}</div>
      </div>
    </div>
  )
}
