import Link from "next/link"
import type { ReactNode } from "react"

/**
 * `.mlist` — the phone's list of rows, and the one element that replaces a
 * table on a 340px screen.
 *
 * Ported from `mlist()` at line 3116 of `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="mlist">
 *   <div class="mli is-link" data-goto="invoice" tabindex="0" role="link">
 *     <div><b>Invoice lines do not reconcile</b><span>I28517 is $57.77 short</span></div>
 *     <div class="rt">$57.77<em class="down">short</em></div>
 *   </div>
 *   …
 * </div>
 * ```
 *
 * `.mlist` is a bare `display:grid`; every rule that matters is on `.mli`,
 * including `:last-child{border-bottom:none}`. So `MList` must be the thing
 * that wraps the rows, exactly as `Strip` must wrap its figures.
 *
 * ## A row that navigates is an `<a>`, not a div wearing `role="link"`
 *
 * The prototype has no router, so `mlist()` writes `data-goto` onto a `<div>`
 * and gives it `tabindex="0" role="link"` to make it reachable. We have a
 * router. `.mli` is a two-column grid, `.mli.is-link::after` draws the chevron
 * and `.mli.is-link:focus-visible` draws the ring — all three apply to an `<a>`
 * unchanged, and an `<a>` gets middle-click, "open in new tab", the correct
 * role and keyboard activation for free. This is the same trade `StoreCards`
 * declined to make and for the opposite reason: there, `.stcard[aria-expanded]`
 * and a `<dl>` child made a real `<button>` illegal; here nothing does.
 *
 * **THE CHEVRON COMES WITH THE DESTINATION OR NOT AT ALL.** That is the
 * sheet's own comment above `.mli.is-link` (counter-components.css:667): the
 * chevron used to be typed into a row's value, "which meant a row could wear
 * one and go nowhere". `is-link` is set from `href` alone, so a row without one
 * cannot advertise a tap that does nothing.
 *
 * ## What is not ported
 *
 * `mlist()`'s second navigation arm, `{ c, range }` -> `data-setrange`, which
 * makes a row set the prototype's date control. Ours is real state driven by
 * `writeCounterParams`, not a data attribute a delegated listener reads, and
 * nothing on the phone Overview uses that arm. It is left out rather than
 * emitted as markup that looks wired and is not (note 46).
 *
 * `Section` is the sole state renderer (R3). A row is plain data.
 */
export interface MListRow {
  key: string
  /** `<b>` — what the row is. */
  title: string
  /** `<span>` — the second line. Omitted, not blank, when there isn't one. */
  detail?: ReactNode
  /** `.rt` — the figure on the right. Pre-formatted. */
  value: ReactNode
  /** `.rt em` — the qualifier under the figure. */
  note?: ReactNode
  /**
   * `.rt em.up` / `.rt em.down`. The bare `em` is `--ink-3`; these two are the
   * only overrides the sheet has, so there is no third tone to pass.
   */
  noteTone?: "up" | "down"
  /** Where the row goes. Absent means the row is not a link and wears no chevron. */
  href?: string
}

export function MList({ rows }: { rows: MListRow[] }) {
  return (
    <div className="mlist">
      {rows.map((r) => {
        const body = (
          <>
            <div>
              <b>{r.title}</b>
              {r.detail ? <span>{r.detail}</span> : null}
            </div>
            <div className="rt">
              {r.value}
              {r.note ? <em className={r.noteTone}>{r.note}</em> : null}
            </div>
          </>
        )

        return r.href ? (
          <Link key={r.key} className="mli is-link" href={r.href}>
            {body}
          </Link>
        ) : (
          <div key={r.key} className="mli">
            {body}
          </div>
        )
      })}
    </div>
  )
}
