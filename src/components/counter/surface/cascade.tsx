import { TABULAR, money } from "@/lib/counter/format"

export interface CascadeStep {
  label: string
  /** Negative for a subtraction. The sign carries the meaning. */
  amount: number
  kind: "start" | "subtract" | "end"
}

/**
 * A statement drawn as what it is: a sequence of subtractions.
 *
 * Note 52: the old page answered "where does the revenue go" with a five-slice
 * donut, which answers "what share" — a different question. Each bar here is
 * what is LEFT after that subtraction, so the reader watches the money run
 * down rather than comparing wedges.
 */
export function Cascade({ steps }: { steps: CascadeStep[] }) {
  const start = steps.find((s) => s.kind === "start")?.amount ?? 0

  let running = 0
  const rows = steps.map((s) => {
    running = s.kind === "start" ? s.amount : s.kind === "end" ? s.amount : running + s.amount
    return { ...s, remaining: running }
  })

  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div key={r.label} data-cascade-step className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <span className="text-ct-body text-ct-ink">{r.label}</span>
            <span className={`text-ct-body text-ct-ink-2 ${TABULAR}`}>{money(r.amount, { cents: true })}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-ct-sm bg-ct-sunk">
            <span
              data-cascade-remaining
              className={`block h-2 rounded-ct-sm ${r.kind === "end" ? "bg-ct-accent" : "bg-ct-ink-3"}`}
              style={{ width: `${widthPct(r.remaining, start)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * `start` is a zero-revenue day's denominator (closed store, a channel filter
 * with no orders). Dividing by it would produce "NaN%" or "Infinity%" — a
 * `ready` state with no state guard to catch it. Zero start collapses every
 * bar to 0%, and the result is clamped to [0, 100] so a negative `remaining`
 * (a statement that ran below zero) doesn't paint outside the track either.
 */
function widthPct(remaining: number, start: number): number {
  if (start === 0) return 0
  const pct = (remaining / start) * 100
  return round1(Math.min(100, Math.max(0, pct)))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
