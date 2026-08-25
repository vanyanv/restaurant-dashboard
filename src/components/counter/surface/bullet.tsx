import { bulletGeometry, type Reference } from "@/lib/counter/bullet-state"

/**
 * The mark every judged figure carries: an acceptable range, the measure, the
 * reference tick, and where the figure actually sits.
 *
 * Ported from `bullet()` at line 3745 of `docs/counter/counter-prototype.html`
 * — same element order, same class names, same `toFixed(1)` percentages. Every
 * class here (`blt`, `blt__band`, `blt__fill`, `blt__over`, `blt__tick`,
 * `blt__now`) is already styled in `src/styles/counter-components.css`; there
 * is no CSS of its own to write.
 *
 * Takes plain data and nothing else. `Section` is the sole state renderer
 * (R3): a `Bullet` knows nothing about loading, empty or failed.
 */
export function Bullet({
  reference,
  className,
}: {
  reference: Reference
  /** The prototype's `cls` argument — `blt--lead` at headline scale. */
  className?: string
}) {
  const g = bulletGeometry(reference)

  return (
    <span
      className={className ? `blt ${className}` : "blt"}
      role="img"
      aria-label={reference.label ?? ""}
    >
      {g.band ? (
        <span className="blt__band" style={{ left: g.band.left, width: g.band.width }} />
      ) : null}
      <span className="blt__fill" style={{ width: g.fill.width }} />
      {g.over ? (
        <span className="blt__over" style={{ left: g.over.left, width: g.over.width }} />
      ) : null}
      {g.tick ? <span className="blt__tick" style={{ left: g.tick.left }} /> : null}
      <span
        className={g.status === "ok" ? "blt__now" : `blt__now is-${g.status}`}
        style={{ left: g.now.left }}
      />
    </span>
  )
}
