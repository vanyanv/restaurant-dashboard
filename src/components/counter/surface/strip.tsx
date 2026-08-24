import { hasData, type SectionData } from "@/lib/counter/section-data"
import { Figure, type FigureProps } from "./figure"

/**
 * A ruled strip of figures — the design's answer to a card grid, which turns
 * every number into a box and makes none of them the point.
 *
 * The strip keeps its SHAPE in every state. A loading strip shows the same
 * number of cells it will show when loaded, and an empty one shows em-dashes,
 * so the layout does not jump when figures land.
 */
export function Strip<T>({
  data,
  cells,
  cellCount,
}: {
  data: SectionData<T>
  cells: (data: T) => FigureProps[]
  /** How many cells to reserve before data exists. Defaults to 4. */
  cellCount?: number
}) {
  const n = cellCount ?? 4

  if (hasData(data)) {
    const items = cells(data.data)
    return (
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-ct bg-ct-line md:grid-cols-4">
        {items.map((c) => (
          <div key={c.label} className="bg-ct-surface p-4">
            <Figure {...c} />
          </div>
        ))}
      </div>
    )
  }

  if (data.status === "loading") {
    return (
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-ct bg-ct-line md:grid-cols-4">
        {Array.from({ length: n }, (_, i) => (
          <div key={i} data-skeleton-cell className="bg-ct-surface p-4">
            <span className="mb-2 block h-2 w-1/2 rounded-ct-sm bg-ct-sunk" />
            <span className="block h-6 w-3/4 rounded-ct-sm bg-ct-sunk" />
          </div>
        ))}
      </div>
    )
  }

  // empty, failed and not_computed all reserve the shape with em-dashes. A
  // Section renders the explanation above; the strip's job is to not collapse.
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-ct bg-ct-line md:grid-cols-4">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="bg-ct-surface p-4">
          <span className="block text-ct-xl text-ct-ink-3">—</span>
        </div>
      ))}
    </div>
  )
}
