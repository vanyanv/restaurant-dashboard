import { TABULAR } from "@/lib/counter/format"

/**
 * A measure against a published reference.
 *
 * Note 35: colour the OVERSHOOT, not the measure. Painting the whole bar red on
 * a breach reads as "a lot of bad"; painting only the distance past the line
 * reads as "past the line by this much", which is the actual information.
 *
 * `format` and `target` are pre-formatted text, not a function — every other
 * primitive (`Figure.value`) takes a string, and formatting belongs to
 * `@/lib/counter/format`, not to a closure passed in as a prop.
 */
export function Meter({
  label,
  value,
  reference,
  max,
  format,
  target,
}: {
  label: string
  value: number
  reference: number
  max: number
  /** Pre-formatted value, e.g. `"56.2%"`. */
  format: string
  /** Pre-formatted reference, e.g. `"60.0%"`. Defaults to `format`. */
  target?: string
}) {
  // `max === 0` is a `ready` state with nothing to divide by (no ceiling
  // published yet) — every width collapses to 0% rather than NaN/Infinity%.
  // Widths are also clamped to [0, 100]: a negative value would otherwise
  // produce a negative width, and a value past `max` would paint outside the
  // track now that the track clips its own overflow.
  const pctOf = (v: number) => `${clampPct(max === 0 ? 0 : (v / max) * 100)}%`
  const over = value > reference

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">
          {label}
        </span>
        <span className={`text-ct-mid font-semibold text-ct-ink ${TABULAR}`}>{format}</span>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-ct-sm bg-ct-sunk">
        <span
          data-meter-fill
          className="absolute inset-y-0 left-0 rounded-ct-sm bg-ct-ink-3"
          style={{ width: pctOf(Math.min(value, reference)) }}
        />
        {over ? (
          <span
            data-meter-overshoot
            className="absolute inset-y-0 bg-ct-bad"
            style={{ left: pctOf(reference), width: pctOf(value - reference) }}
          />
        ) : null}
        <span
          data-meter-reference
          className="absolute inset-y-[-2px] w-px bg-ct-line-strong"
          style={{ left: pctOf(reference) }}
        />
      </div>
      <span className="font-ct-mono text-ct-micro text-ct-ink-3">
        target {target ?? format}
      </span>
    </div>
  )
}

function clampPct(n: number): number {
  return Math.round(Math.min(100, Math.max(0, n)) * 10) / 10
}
