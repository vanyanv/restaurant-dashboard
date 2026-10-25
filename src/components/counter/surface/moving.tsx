import type { ReactNode } from "react"

/**
 * `.moving` — the honesty strip.
 *
 * Emitted inline inside `P.overview.desk()` at line 4295 of
 * `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="moving">
 *   <div><span class="k">Still moving</span><span class="v">$412 to the call</span>
 *        <span class="n">Against a $6,180 forecast · 20 minutes of service left</span></div>
 *   <div><span class="k">Not in the figures</span>…</div>
 *   <div><span class="k">Labor posted</span>…</div>
 * </div>
 * ```
 *
 * EVERY CELL NAMES SOMETHING THE FIGURES ABOVE IT DO NOT INCLUDE. That is the
 * whole point of the strip and the reason it is painted on `--signal-wash`
 * rather than the surface: the head block states what is known, and this
 * states what is still open. Overview's three are the range (or "Still moving"
 * on a single day, because a day in progress has no range yet), the invoices
 * that are approved but not posted — so COGS above is understated by a stated
 * amount — and the labour that HAS posted, with the loaded rate that turned
 * hours into the money. A cell that carries good news belongs in the strip
 * above, not here.
 *
 * Each cell is a BARE `<div>` with no class of its own: `.moving>div` is the
 * rule that lays it out and rules it off from the next
 * (counter-components.css:378), and `:last-child` drops the trailing rule. So
 * `Moving` must be the thing that wraps these, exactly as `Strip` must wrap
 * its figures.
 *
 * There is no `data-n` here and none is wanted — `.moving>div` is
 * `flex:1 1 190px`, so the cells size themselves and a fourth wraps onto a
 * second row that the flex rule already handles.
 *
 * `Section` is the sole state renderer (R3). The prototype renders `.moving`
 * only when `eff()` is neither `loading` nor `empty`; here that is the
 * caller's `Section`, not this component's business.
 */
export interface MovingCell {
  /** `.k` — what is still open. */
  label: string
  /** `.v` — how much of it. */
  value: string
  /** `.n` — why it is not in the figures above. */
  note: ReactNode
}

export function Moving({ cells }: { cells: MovingCell[] }) {
  /*
   * NOTHING MOVING, NO BAND.
   *
   * `.moving` is a signal-coloured bar spanning the page, and its whole job is
   * to name what is not in the figures above it. Rendering it empty draws the
   * loudest element on the screen around no content at all — and an adapter
   * that has nothing to put in it has to be able to say so without the page
   * branching on a status. Returning null is how: `Section bare` hands over an
   * empty array and this draws nothing, rather than the page deciding.
   *
   * NOT an `empty` section either. `Empty` is a 46px-padded block with a
   * headline, which is a bigger thing than the band it replaces — a state that
   * announces the absence of an announcement.
   */
  if (cells.length === 0) return null

  return (
    <div className="moving">
      {cells.map((c) => (
        <div key={c.label}>
          <span className="k">{c.label}</span>
          <span className="v">{c.value}</span>
          <span className="n">{c.note}</span>
        </div>
      ))}
    </div>
  )
}
