"use client"

import type { ReactNode } from "react"
import { useCountUp } from "./use-count-up"
import { useChanged } from "./use-changed"
import { count, money, pct } from "@/lib/counter/format"

/**
 * A figure that counts up to what it already says (spec §5.4: "figures count
 * up to what they already say over 480ms, keeping currency and decimals").
 *
 * `useCountUp` had been exported for a phase with no consumer: every lead
 * figure was handed a pre-formatted string, so the number could not move.
 * This is the one place a page hands over the NUMBER and the formatter it
 * would otherwise have called itself — `format` is still `@/lib/counter/format`,
 * so the figure is worded exactly as it would be at rest, on every frame.
 *
 * Renders the target on the server and on the first client render (the
 * hook's own hydration contract), so a test reading the text sees the final
 * figure and a screen reader is never handed a number in flight.
 */
export function CountUp({
  value,
  format,
}: {
  value: number
  format: (v: number) => string
}) {
  const shown = useCountUp(value)
  // D3: a figure that changed after first paint wears `ct-changed` for the
  // length of its cell's cool-down (counter-repairs.css reads it through
  // `:has()` on the cell), so the reader's eye is taken to the one cell that
  // moved. Never on mount, so a page's first paint carries no marks.
  const changed = useChanged(value)
  return <span className={changed ? "ct-changed" : undefined}>{format(shown)}</span>
}

/**
 * How a pre-formatted figure counts up: the NUMBER and the NAME of the
 * formatter that produced its string. A function cannot cross the RSC
 * boundary, and an adapter builds its cells on the server — so the adapter
 * names the formatter and `Arriving` calls it. The four names are the four
 * calls the adapters actually make for a strip cell; `pct` is the scaled
 * form (`pct(v, { scaled: true })`), which is the only form a strip uses.
 *
 * The string the adapter wrote stays the canonical text: it is what a test
 * reads, what the server renders, and what the count ends on, because the
 * hook lands exactly on `value` and the formatter is the same one.
 */
export interface Arrival {
  value: number
  as: "money" | "moneyCents" | "pct" | "count"
}

const AS: Record<Arrival["as"], (v: number) => string> = {
  money: (v) => money(v),
  moneyCents: (v) => money(v, { cents: true }),
  pct: (v) => pct(v, { scaled: true }),
  count,
}

/** A figure's text, counting up when the adapter said how. */
export function Arriving({ arrive, children }: { arrive?: Arrival; children: ReactNode }) {
  if (!arrive) return <>{children}</>
  return <CountUp value={arrive.value} format={AS[arrive.as]} />
}
