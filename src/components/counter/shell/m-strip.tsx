import { bwords, isJudged } from "@/lib/counter/bullet-state"
import { Bullet } from "@/components/counter/surface/bullet"
import type { FigureProps } from "@/components/counter/surface/figure"
import { Arriving } from "@/components/counter/motion/count-up"

/**
 * `.mstrip` — the phone's ruled strip of figures.
 *
 * Ported from `mstrip()` at line 3093 of `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="mstrip">
 *   <div>
 *     <span class="k">Sales / labor hr</span>
 *     <span class="v">$74.10</span>
 *     <span class="d">▲ $3.90</span>          ← only when there is a delta
 *     <span class="blt">…</span>              ← only when the reference is judged
 *     <span class="band">above floor $68.00</span>
 *   </div>
 *   …five more…
 * </div>
 * ```
 *
 * A cell is a BARE `<div>` with no class, exactly as in `strip()`: `.mstrip>div`
 * is the rule that pads it, and `:nth-child(2n)` / `:nth-last-child(-n+2)` are
 * what rule it off from its neighbours. So `MStrip` must be the thing that
 * wraps these, and there is nothing for a caller to remember.
 *
 * ## Three ways this is NOT `Strip`, all of them the prototype's
 *
 * 1. **No `.sp`.** The prototype's own comment, at the top of the map: *"The
 *    phone takes the mark but not the trajectory: the two charts are directly
 *    beneath it and vertical space is the scarce thing here."* `Figure` emits a
 *    sparkline whenever the reference carries a series, so reusing it here
 *    would put six sparklines on the phone that the design deliberately
 *    removed. That is why this renders its own cell rather than delegating.
 * 2. **No `data-n`.** `.strip` is a six-track grid whose track count is
 *    overridden per `data-n`; `.mstrip` is `grid-template-columns:1fr 1fr`,
 *    full stop. There is no rule to feed, and an attribute the sheet does not
 *    read is an attribute the fidelity gate would report as a difference.
 * 3. **A band needs a reference.** `Figure`'s band opens on `caption ||
 *    reference`; `mstrip()`'s opens only inside `r ? … : ''`, so a caption with
 *    no reference draws nothing at all. Same condition, transcribed.
 *
 * ## The cell count is the layout, and six is the only count on Overview
 *
 * `.mstrip>div:nth-child(2n)` drops the right rule on every even cell and
 * `:nth-last-child(-n+2)` drops the bottom rule on the last two. An ODD number
 * of cells therefore leaves the final cell alone on its row with a right-hand
 * rule against nothing. The prototype's phone strips are all even (six on
 * Overview, two everywhere else); this is recorded rather than guarded,
 * because clamping would be inventing a cell.
 *
 * `Section` is the sole state renderer (R3): an `MStrip` takes cells and
 * renders exactly that many.
 */
export function MStrip({ cells }: { cells: FigureProps[] }) {
  return (
    <div className="mstrip">
      {cells.map((c, i) => (
        <MCell key={i} {...c} />
      ))}
    </div>
  )
}

function MCell({ label, value, arrive, delta, deltaTone, caption, reference }: FigureProps) {
  const judged = reference != null && isJudged(reference)
  // `quiet` draws the meter but says nothing about it — no flag words.
  const spoken = judged && !reference.quiet
  // `bwords` already carries the status the flag's own `is-*` class is
  // written from, so it is read off the flag rather than computed twice.
  const flag = spoken ? bwords(reference) : null

  return (
    <div>
      <span className="k">{label}</span>
      <span data-figure-value className="v">
        <Arriving arrive={arrive}>{value}</Arriving>
      </span>
      {delta ? <span className={deltaTone ? `d ${deltaTone}` : "d"}>{delta}</span> : null}
      {judged ? <Bullet reference={reference} /> : null}
      {reference ? (
        judged || caption ? (
          <span className="band">
            {flag ? (
              <>
                <span className={`flag is-${flag.status}`}>
                  <i />
                  {flag.word}
                </span>{" "}
              </>
            ) : null}
            {caption}
          </span>
        ) : null
      ) : null}
    </div>
  )
}
