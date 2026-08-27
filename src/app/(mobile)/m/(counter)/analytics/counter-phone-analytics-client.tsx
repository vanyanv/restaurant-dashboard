"use client"

import { useMemo } from "react"
import { Chart, MStrip, Section } from "@/components/counter"
import { readCounterParams } from "@/lib/counter/url-state"
import { count, money, pct } from "@/lib/counter/format"
import { dayCount, rangeLabel } from "@/lib/counter/date-range"
import type { AnalyticsSections } from "@/lib/counter/adapters/analytics"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * Counter Analytics — the phone.
 *
 * `P.analytics.phone()` at line 4975 of `docs/counter/counter-prototype.html`,
 * composed in its own order:
 *
 *   `.mtitle` / `.msub` → a four-cell `mstrip` →
 *   `sec('Channel mix', …)` → `sec('By day of week', …)`
 *
 * It calls the SAME adapter the desk calls (`getAnalyticsSectionPromises`),
 * through the same `readCounterParams`, so no figure here can disagree with
 * the same figure on `/dashboard/analytics`: they are the same fields off the
 * same `SectionData`, not a second reading of the range.
 *
 * ## THIS FILE DOES NO ARITHMETIC EITHER
 *
 * Same rule as the desk island's own note: every figure, caption and
 * sentence below is a field of the adapter's payload. The only strings this
 * file writes are chrome — the page title, the range in the subtitle, and
 * the "N days" qualifier under "By day of week", which describes the chart
 * rather than the data in it.
 *
 * ## Four departures from the desk, all the prototype's own
 *
 * | Desk | Phone |
 * |---|---|
 * | `.strip`, three cells, drawn from `h.cells` | `.mstrip`, FOUR cells, drawn from `h.phoneCells` |
 * | Commission as a percentage | Commission in DOLLARS, captioned with the percentage |
 * | Channel mix: direct labels on the bands, no legend | a legend naming all four channels, direct labels off |
 * | mix drill (`Drill` + `Table`) under the chart | one sentence (`m.sentence`) — there is no room for a drill at 340px |
 * | "When the orders come" — a whole `.sec` | dropped entirely; not in `P.analytics.phone()`'s composition |
 *
 * `phoneCells` is not a slice of `h.cells` — the adapter documents why: the
 * phone's fourth cell is Best day (A-R3 removes "Repeat guests" from the desk
 * strip, not from this one, because this strip never had it), and its
 * commission cell prints a different figure kind than the desk's. A page
 * slicing the desk's array by position would hand the phone the wrong cell
 * the moment a cell is withheld.
 *
 * ## Where the drift-warning ruling landed here
 *
 * A section with nothing to show resolves `not_computed` inside the adapter,
 * not inside this file — `Section` is the sole state renderer and this page
 * never inspects `SectionData.status`. Concretely: `buildPhoneStrip` omits
 * the Best day cell rather than drawing a fourth reading "—" when the range
 * holds no day at all, so the strip itself is never a heading over a blank
 * fourth cell; and `MixSection.drill.enough === false` prints the adapter's
 * own paragraph in place of a table, never a `.sec` with an empty table
 * inside it — though this page does not draw the drill on the phone at all,
 * only the one `sentence` line, which the adapter always populates whenever
 * the section resolves `ready`.
 */
export function CounterPhoneAnalyticsClient({
  params: paramsString,
  today,
  sections,
}: {
  /** The query string as PLAIN TEXT — a `URLSearchParams` loses its prototype crossing the RSC boundary. */
  params: string
  today: Date
  sections: SectionSources<AnalyticsSections>
}) {
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  const { range } = counterParams
  // The window's own ENDS, never the preset's name — same convention as
  // every other Counter route's `windowLabel`.
  const windowLabel = rangeLabel(range, "custom")
  const days = dayCount(range)

  // A share, on a chart whose readings are already 0..100 — same helper the
  // desk island declares under the same name, for the same reason.
  const share = (v: number) => pct(v, { scaled: true })

  return (
    /*
     * A FRAGMENT. `.ct-root.ct-phone`, `.mtop` and `.mscroll` are
     * `src/app/(mobile)/m/(counter)/layout.tsx`'s now — see
     * `counter-phone-overview-client.tsx` for the long version. What is
     * rendered here is what goes INSIDE `.mscroll`, unchanged.
     */
    <>
      {/*
        The page's NAME, and the window beneath it — `P.analytics.phone()`
        prints only the range here, with no day count, unlike the P&L's own
        msub. The store is not in this sub: `.mtop`'s `.st` is already
        showing it, one element up.
      */}
      <div>
        <h2 className="mtitle">Analytics</h2>
        <p className="msub">{windowLabel}</p>
      </div>

      {/* Four cells: Net sales, Marketplaces, Commission (in dollars, captioned
          with the percentage), Best day. `h.phoneCells`, never a slice of
          `h.cells` — see the file note above. */}
      <Section bare title="The figures" data={sections.headline}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      {/* The legend is ON and direct labels are OFF: at 340px a label written
          on a 20px band is a label nobody can read. That is the prototype's
          own choice (`m.phoneChart`), not a reshaping done here. */}
      <Section title="Channel mix" meta={(m) => m.subtitle} data={sections.mix}>
        {(m) => (
          <>
            <Chart {...m.phoneChart} fmt={share} />
            <p className="mono">{m.sentence}</p>
          </>
        )}
      </Section>

      {/* Seven single-letter labels and a shorter plot (`w.phoneChart`). No
          sentence here — `P.analytics.phone()`'s own composition stops at the
          chart; there is no room left on this surface for the reading
          paragraph the desk prints beside it. */}
      <Section
        title="By day of week"
        meta={`${count(days)} ${days === 1 ? "day" : "days"}`}
        data={sections.weekday}
      >
        {(w) => <Chart {...w.phoneChart} fmt={(v) => money(v)} />}
      </Section>
    </>
  )
}
