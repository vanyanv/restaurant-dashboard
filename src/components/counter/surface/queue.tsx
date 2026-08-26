import type { ReactNode } from "react"
import Link from "next/link"
import { toneStyle, type Tone } from "./tone"

/**
 * One thing that needs the owner: how big it is, what it is, and the one thing
 * to do about it.
 */
export type QueueItem = {
  key: string
  /** Which of the three judgement colours the lead figure reads in. */
  tone: Tone
  /** The prototype's `i.lead` — the figure, already formatted. */
  lead: string
  /** `i.unit` — the `<em>` under the figure: "lines", "per lb", "margin". */
  unit?: string
  title: string
  body: ReactNode
} & (
  | /**
     * `act` and its handler arrive together or not at all. The prototype
     * renders `.do` on `i.act` alone and wires it through a global
     * `data-goto` delegate; we have no such delegate, and a button that does
     * nothing is worse than no button (the same rule `Failed` follows), so
     * the type makes the pair inseparable.
     */
  { act: string; onAct: () => void; href?: never }
  | /**
     * The same rule, for the arm the prototype actually uses most: `data-goto`
     * is a DESTINATION, not a callback. Without this, an adapter with somewhere
     * to send the reader had to invent a handler or drop the button — the
     * order page dropped it, which cost that page its `.do` landmark and left
     * a worklist item telling a reader to do something with no way to go do it.
     */
  { act: string; href: string; onAct?: never }
  | { act?: undefined; onAct?: undefined; href?: never }
)

/**
 * The "what needs you" list. Ported from `queue()` at line 3074 of
 * `docs/counter/counter-prototype.html`:
 *
 *   <div class="queue">
 *     <div class="qitem">
 *       <span class="lead" style="color:var(--tone)">lead<em>unit</em></span>
 *       <div><b>title</b><p>body</p><button class="do">act</button></div>
 *     </div>
 *   </div>
 *
 * `.qitem` is a two-column grid whose first track is the lead figure and whose
 * second is that inner `<div>` — which carries no class, exactly as in the
 * prototype, because `.qitem b`, `.qitem p` and `.qitem .do` style its
 * children directly. Wrapping them in anything classed would be inventing an
 * element the sheet has no rule for.
 *
 * The inline `style` on `.lead` is the one place a colour legitimately appears
 * in a Counter TSX file: it names a token rather than a value, and the token
 * comes from a checked union — see `./tone`.
 *
 * Sole state renderer is `Section` (R3): a `Queue` takes plain items.
 */
export function Queue({ items }: { items: QueueItem[] }) {
  return (
    <div className="queue">
      {items.map((i) => (
        <div className="qitem" key={i.key}>
          <span className="lead" style={toneStyle(i.tone)}>
            {i.lead}
            {i.unit ? <em>{i.unit}</em> : null}
          </span>
          <div>
            <b>{i.title}</b>
            <p>{i.body}</p>
            {i.act && i.href ? (
              // A link, not a button: it navigates, so it has to be
              // middle-clickable and copyable like every other destination on
              // the page. `.do` styles either element.
              <Link className="do" href={i.href}>
                {i.act}
              </Link>
            ) : i.act ? (
              <button className="do" type="button" onClick={i.onAct}>
                {i.act}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
