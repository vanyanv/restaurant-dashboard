import { TABULAR } from "@/lib/counter/format"

/**
 * A measure against a published reference.
 *
 * Note 35: colour the OVERSHOOT, not the measure. Painting the whole bar red on
 * a breach reads as "a lot of bad"; painting only the distance past the line
 * reads as "past the line by this much", which is the actual information.
 */
export function Meter({
  label,
  value,
  reference,
  max,
  format,
}: {
  label: string
  value: number
  reference: number
  max: number
  format: (v: number) => string
}) {
  const pctOf = (v: number) => `${round1((v / max) * 100)}%`
  const over = value > reference

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">
          {label}
        </span>
        <span className={`text-ct-mid font-semibold text-ct-ink ${TABULAR}`}>{format(value)}</span>
      </div>
      <div className="relative h-3 w-full rounded-ct-sm bg-ct-sunk">
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
        target {format(reference)}
      </span>
    </div>
  )
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
