/**
 * A fixed-domain meter, so a column of them can be compared down the page.
 *
 * Ported from `meter()` at line 5423 of `docs/counter/counter-prototype.html`:
 *
 * ```
 * <span class="mtr is-over">
 *   <i class="mtr__f" style="width:62.4%"></i>
 *   <i class="mtr__t" style="left:55.0%"></i>
 * </span>
 * ```
 *
 * ## What changed, and why this was rewritten
 *
 * The previous version drew a label row, a track and a caption out of Tailwind
 * utilities (`bg-ct-sunk`, `bg-ct-ink-3`, `data-meter-fill`) and emitted none
 * of the ported sheet's four rules. It rendered plausibly and matched nothing:
 * `.mtr` is one of the fidelity gate's landmark classes and nothing in the tree
 * emitted it. Phase B's rule is that a component that renders unstyled has the
 * wrong DOM — and the inverse failure, a component styled by utilities that
 * duplicate the sheet, is the same defect with the evidence hidden.
 *
 * The label and the caption went with it, because the prototype's meter has
 * neither: it is a bare mark that sits INSIDE a table cell or beside a row's
 * own label, and drawing its own label row made it impossible to put one in a
 * column. The caller supplies the words it already has.
 *
 * ## Fixed domain is the whole point
 *
 * `lo` and `hi` are the domain of the COLUMN, not of this row. Scaling each
 * meter to its own value would make a stack of them look identical and mean
 * nothing — the reason they can be read down a page is that 60% is the same
 * distance in every one of them.
 *
 * ## Note 35, and where the overshoot colour actually lives
 *
 * `is-over` recolours the fill, and it is set by the CALLER, not derived from
 * `value > target`: "over" depends on which direction is bad, which the meter
 * cannot know (a sales meter under its target is the bad one). The
 * paint-only-the-overshoot treatment note 35 asks for belongs to `.blt`
 * (`Bullet`), which draws `.blt__over` as its own segment; `.mtr` is the
 * smaller mark used where a bullet does not fit, and the ported sheet colours
 * its whole fill. That is the prototype's own split and it is kept.
 */
export function Meter({
  value,
  lo,
  hi,
  target,
  over,
  label,
}: {
  value: number
  /** The bottom of the shared domain. */
  lo: number
  /** The top of the shared domain. */
  hi: number
  /** The published reference, drawn as a tick. Omitted when there is none. */
  target?: number
  /** Whether this reading is on the wrong side of its reference. The caller's call. */
  over?: boolean
  /**
   * The sentence a screen reader gets. The prototype's `.mtr` has none — its
   * sibling mark `.blt` emits `role="img" aria-label`, so the omission reads as
   * an oversight rather than a decision, and a bar with no accessible name is
   * simply absent from the reading.
   */
  label: string
}) {
  // `hi === lo` is a domain with no width — a column where every row read the
  // same, or a range whose bounds were never published. Every position
  // collapses to 0% rather than dividing into NaN%/Infinity%.
  const x = (n: number) => {
    if (hi === lo) return 0
    return Math.max(0, Math.min(100, ((n - lo) / (hi - lo)) * 100))
  }

  return (
    <span className={over ? "mtr is-over" : "mtr"} role="img" aria-label={label}>
      <i className="mtr__f" style={{ width: `${x(value).toFixed(1)}%` }} />
      {target === undefined ? null : (
        <i className="mtr__t" style={{ left: `${x(target).toFixed(1)}%` }} />
      )}
    </span>
  )
}
