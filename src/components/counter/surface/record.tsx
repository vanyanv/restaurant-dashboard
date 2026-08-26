export type RecordMark = "hit" | "miss"

/**
 * `.record` — the forecast's run of days, one mark each, oldest first.
 *
 * Deliberately not a chart: the question it answers is "how often", and thirty
 * marks answer it faster than thirty bars.
 *
 * The prototype's `rec()` (counter-prototype.html:3711) marks a miss with
 * class "m" and leaves a hit with no class at all — `.record i` alone already
 * carries the hit colour, and `.record i.m` is the only override
 * (src/styles/counter-components.css:406-408). The public `RecordMark` type
 * stays the readable "hit" | "miss" for callers; only the emitted class name
 * follows the prototype's convention.
 */
export function Record({ marks }: { marks: RecordMark[] }) {
  return (
    <div className="record">
      {marks.map((m, i) => (
        <i className={m === "miss" ? "m" : undefined} key={i} />
      ))}
    </div>
  )
}
