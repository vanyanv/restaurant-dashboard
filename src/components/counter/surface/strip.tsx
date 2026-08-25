import { Figure, type FigureProps } from "./figure"

/**
 * A ruled strip of figures — the design's answer to a card grid, which turns
 * every number into a box and makes none of them the point.
 *
 * `strip()` at line 3008 of `docs/counter/counter-prototype.html`: a
 * `.strip` whose cells are bare `<div>`s carrying no class at all, and a
 * `data-n` recording how many there are.
 *
 * `data-n` IS THE LAYOUT. `.strip` is a six-track grid by default and
 * `counter-components.css` overrides the track count for `data-n` 2, 3, 4 and
 * 5 (lines 1052–1057). Omit it and a four-cell strip lays out across six
 * tracks with two empty columns — and the fidelity gate compares the
 * attribute directly, so it reports as a finding too.
 *
 * TWO CELL COUNTS THE STYLESHEET HAS NO RULE FOR, and they do not degrade
 * gracefully:
 *   - `data-n="1"` — no rule, so it falls through to the six-track default and
 *     the single cell renders one sixth of the width with five empty tracks
 *     beside it. The prototype never emits a one-cell strip; a lone figure is
 *     a `Figure` with `size="lead"` inside a headline instead.
 *   - `data-n="7"` and up — also no rule, so a seventh cell wraps onto an
 *     implicit second row that no rule sizes or rules off. The prototype's
 *     widest strip is six.
 * Both are recorded rather than clamped: clamping `data-n` would make the
 * attribute lie to the gate that exists to read it.
 *
 * The responsive reflow (`@container fr` at lines 1060–1067) is dormant until
 * something in the app declares `container-name: fr`. Only `.frame` does, and
 * `.frame` is the prototype's own root, not ours — see the task 3 report.
 *
 * Sole state renderer is `Section` (R3): a `Strip` takes cells directly and
 * renders exactly that many — it does not know about loading, empty, failed
 * or any other state.
 */
export function Strip({ cells }: { cells: FigureProps[] }) {
  return (
    <div className="strip" data-n={cells.length}>
      {cells.map((c, i) => (
        <Figure key={i} {...c} size="cell" />
      ))}
    </div>
  )
}
