"use client"

import { useMemo } from "react"
import { Chart, MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import { readCounterParams } from "@/lib/counter/url-state"
import { rangeLabel } from "@/lib/counter/date-range"
import { pct } from "@/lib/counter/format"
import type { CogsSections } from "@/lib/counter/adapters/cogs"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * Counter COGS — the group page, on a phone.
 *
 * `P.cogs.phone()` at line 5421 of `docs/counter/counter-prototype.html`,
 * composed in its own order:
 *
 *   `.mtitle` / `.msub` → a two-cell `mstrip` → `sec('Against plan', …,
 *   chart)` → `sec('What moved', …, mlist)`
 *
 * It calls the SAME adapter the desk calls (`getCogsSectionPromises`),
 * through the same `readCounterParams`, so no figure here can disagree with
 * the same figure on `/dashboard/cogs`: they are the same fields off the
 * same `SectionData`, not a second reading of the range.
 *
 * ## THIS FILE DOES NO ARITHMETIC EITHER
 *
 * Same rule as the desk island's own note. Every figure, caption and
 * sentence below is a field of the adapter's payload. The only strings this
 * file writes are chrome — the page title, the range in the subtitle, and the
 * chart's formatter, which cannot cross the RSC boundary as a function and so
 * has to be written on this side.
 *
 * ## What the phone drops, and it is the prototype and the ruling that drop it
 *
 * | Desk | Phone |
 * |---|---|
 * | Three-cell `Strip` — Food cost, Against plan, Unposted invoices | `.mstrip`, TWO cells: Food cost, Against plan |
 * | "Food cost against plan", chart + sentence + note | "Against plan", chart only, ticks off, one series, rule at the plan |
 * | `.split` of "What moved" and "By menu category" | "What moved" as one `mlist`; the category ring is dropped |
 * | "The items costing the most" table | — |
 *
 * `phoneCells` is not a slice of the desk's `cells` — the adapter's own
 * docblock explains why: a page slicing by position would hand the phone the
 * wrong cell the moment a cell the desk carries (the invoice-backlog cell,
 * dropped whenever that aggregate fails to load) shifts into a different
 * slot.
 *
 * The prototype's second cell is "Theoretical" (29.8%, "from recipes"). It is
 * dropped by the same ruling the desk's strip drops it under (C-R4):
 * `DailyCogsItem.lineCost` already IS the theoretical cost, so a cell reading
 * it beside food cost would print the same number twice under a different
 * label. Nothing stands in its place — the strip is two cells, not two boxes
 * with one reading "—".
 *
 * ## There is no second series and no legend here either (C-R4)
 *
 * Same ruling as the desk's own chart. The prototype's dashed "Theoretical"
 * series needs an ACTUAL to be read against, and the only actual available is
 * purchasing — not consumption without an inventory bridge, and one that
 * swings 37% under to 38% over inside six months on invoice cadence alone.
 * `plan.phoneChart` is the adapter's own shorter, tickless, single-series
 * chart — not a reshaping done here. No sentence and no note: at 340px there
 * is no room left for the desk's prose beside its own chart, and the
 * prototype's phone composition stops at the chart too.
 *
 * ## The caption-versus-delta trap
 *
 * `MCell` (the phone's per-cell renderer) opens its band only inside
 * `reference ? … : ''`, so a `caption` with no `reference` renders NOTHING at
 * all — silently, unlike the desk's `Figure`, which draws an EXTRA landmark
 * for the same prop. Neither cell below passes a `caption`; both qualifiers
 * ride in the `delta` slot instead, and both carry an explicit `deltaTone`
 * from the adapter (`buildHeadline`'s `phoneCells`) — an untoned `.strip .d`
 * paints `var(--good)`, which would turn "of Total Sales" green as if it were
 * good news rather than a plain qualifier.
 */
export function CounterPhoneCogsClient({
  params: paramsString,
  today,
  sections,
}: {
  /** The query string as PLAIN TEXT — a `URLSearchParams` loses its prototype crossing the RSC boundary. */
  params: string
  today: Date
  sections: SectionSources<CogsSections>
}) {
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  /*
   * This page owns no `push` of its own — the date sheet and the store
   * picker are `PhoneShell`'s (`MTop`/`MDateSheet`). `pending` is that same
   * transition, threaded to every `<Section>` below so a store or range
   * change reads as `stale` rather than a blank `loading.tsx`.
   */
  const { pending } = useCounterTransition()

  const { range } = counterParams
  // The window's own ENDS, never a preset's name — same convention as every
  // other Counter route's `windowLabel`. The store is not in this sub:
  // `.mtop`'s `.st` is already showing it, one element up.
  const windowLabel = rangeLabel(range, "custom")

  return (
    /*
     * A FRAGMENT. `.ct-root.ct-phone`, `.mtop` and `.mscroll` are
     * `src/app/(mobile)/m/(counter)/layout.tsx`'s. What is rendered here is
     * what goes INSIDE `.mscroll`, unchanged.
     */
    <>
      <div>
        <h2 className="mtitle">Cost of goods</h2>
        <p className="msub">{windowLabel}</p>
      </div>

      {/* Two cells: Food cost, Against plan. `h.phoneCells`, never a slice of
          `h.cells` — see the file note above. */}
      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      {/* `p.phoneChart` is the adapter's own shorter, tickless, single-series
          chart — not a reshaping done here. No sentence, no note: at 340px
          there is no room left for the desk's prose beside its own chart, and
          the prototype's phone composition stops at the chart too. */}
      <Section title="Against plan" meta={(p) => p.meta} data={sections.plan} pending={pending}>
        {(p) => <Chart {...p.phoneChart} fmt={PCT} />}
      </Section>

      {/* `m.phoneRows` — the adapter's own `MListRow[]`, built beside the
          desk's table so the two surfaces cannot format one movement two
          ways. The category ring and the item table are not on this surface
          at all; see the file note's departure table. */}
      <Section title="What moved" meta={(m) => m.meta} data={sections.moved} pending={pending}>
        {(m) => <MList rows={m.phoneRows} />}
      </Section>
    </>
  )
}

/**
 * The prototype's `PCT`. The plan chart's readings are already 0..100 — a
 * food-cost percentage and a plan rule share one axis — so this is `pct`'s
 * `scaled` form, the same one the desk's own chart formatter uses.
 */
const PCT = (v: number) => pct(v, { scaled: true })
