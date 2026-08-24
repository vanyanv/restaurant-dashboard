import { Figure, type FigureProps } from "./figure"

/**
 * A ruled strip of figures — the design's answer to a card grid, which turns
 * every number into a box and makes none of them the point.
 *
 * Sole state renderer is `Section` (R3): a `Strip` takes cells directly and
 * renders exactly that many — it does not know about loading, empty, failed
 * or any other state. Nest it inside a `Section` to get the six-state
 * contract; a `Strip` rendered on its own has nothing to fall back on.
 */
export function Strip({ cells }: { cells: FigureProps[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-ct bg-ct-line md:grid-cols-4">
      {cells.map((c, i) => (
        <div key={i} className="bg-ct-surface p-4">
          <Figure {...c} />
        </div>
      ))}
    </div>
  )
}
