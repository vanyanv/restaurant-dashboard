"use client"

import { useMemo } from "react"
import {
  Chart,
  MList,
  MStrip,
  Section, useCounterTransition,
  usePageChrome,
  type MListRow,
  type SwitchableStore,
  SubNav,
} from "@/components/counter"
import { storeViewTabs } from "@/lib/counter/nav"
import { readCounterParams } from "@/lib/counter/url-state"
import { rangeLabel } from "@/lib/counter/date-range"
import type { DayBookRow, StoreAnalyticsSections } from "@/lib/counter/adapters/analytics"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * One store's Analytics — the phone. `P.analyticsstore.phone()` at line 7648
 * of `docs/counter/counter-prototype.html`, composed in its own order:
 *
 *   `.mtitle` (the store's own name) / `.msub` (the range) →
 *   a two-cell `mstrip` (Net sales · Food cost) →
 *   `sec('Net sales', …, chart(h:116, ticks off))` →
 *   `sec('The day book', 'newest first', mlist(…))`
 *
 * It calls the SAME adapter the desk sibling calls
 * (`getStoreAnalyticsSectionPromises`), through the same `readCounterParams`,
 * so no figure here can disagree with the same figure on
 * `/dashboard/analytics/<storeId>`: they are the same fields off the same
 * `SectionData`, not a second reading of the range.
 *
 * ## THIS FILE DOES NO ARITHMETIC EITHER
 *
 * Same rule as every other Counter island's own note: every figure, caption
 * and row below is a field of the adapter's payload, already formatted. The
 * day book's rows come off `DayBook.phoneRows` — the adapter's own slice to
 * four, newest first — not `rows.slice(0, 4)` written here, for the same
 * reason the adapter's own comment gives: a page deciding how much of a table
 * is the whole story is a decision every surface that made it would have to
 * agree on.
 *
 * ## Deliberately much smaller than the desk sibling
 *
 * The desk page draws seven sections: the strip, net sales, the hourly shape,
 * the channel mix, top items, the day book, the statement and the category
 * table. The phone draws three: the strip, net sales and the day book. That
 * is the prototype's own composition, not a partial port — mobile is a lean
 * glance-and-do tool, standing direction for this project, and a phone
 * reader mid-service has room for what changed today and what the day book
 * says about it, not a second copy of the desk's statement at 340px.
 *
 * ## Where the drift-warning ruling landed here
 *
 * A section with nothing to show resolves `not_computed` or `empty` inside
 * the adapter, never inside this file — `Section` is the sole state renderer
 * and this page never inspects `SectionData.status`. A `pre_open` store's
 * `dayBook` therefore never draws a heading over zero rows: `scopeEmptyReason`
 * marks the whole section `empty("pre_open")` before `DayBook.phoneRows` is
 * ever built, and `Section` swaps in `Empty`'s own reason instead of the
 * `mlist`.
 */
export function CounterPhoneStoreAnalyticsClient({
  params: paramsString,
  storeId,
  stores,
  today,
  sections,
}: {
  /** The query string this page was rendered for, as PLAIN TEXT — not a `URLSearchParams` instance. */
  params: string
  /** The PATH's store — what scopes this page. There is no `?store=` here. */
  storeId: string
  stores: SwitchableStore[]
  today: Date
  sections: SectionSources<StoreAnalyticsSections>
}) {
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  /*
   * The SAME transition the phone shell's own store switcher and date
   * sheet start. Threading `pending` into every Section below is what
   * turns a range or store change into a stale banner over the last good
   * figures instead of a blank `loading.tsx` — and it is what the desk
   * Analytics has always done. This page was the only date-scoped phone
   * route without it, so the same page blanked on a phone and held its
   * figures on a desk.
   */
  const { pending } = useCounterTransition()

  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  const store = stores.find((s) => s.id === storeId) ?? null
  // `page.tsx` 404s on a store the switcher does not list, so this fallback is
  // for a store list that failed to load rather than for a wrong id.
  const storeName = store?.name ?? "This store"

  // The store is published upward because the URL cannot say it here: the
  // phone's `.mtop` reads `?store=`, and there is none on this route, so
  // without this the sheet would show "All stores" on a page about one, and
  // its picker would highlight nothing.
  usePageChrome({ storeId, storeName })

  const { range } = counterParams
  // The window's own ENDS, never the preset's name — same convention as
  // every other Counter route's `windowLabel`.
  const windowLabel = rangeLabel(range, "custom")

  return (
    /*
     * A FRAGMENT. `.ct-root.ct-phone`, `.mtop` and `.mscroll` are
     * `src/app/(mobile)/m/(counter)/layout.tsx`'s now — see
     * `counter-phone-overview-client.tsx` for the long version. What is
     * rendered here is what goes INSIDE `.mscroll`, unchanged.
     */
    <>
      {/* `VIEWS`'s group/store pair, first inside `.mscroll`. "One store"
          appears only once a store is picked — the design's own sequence. */}
      <SubNav items={storeViewTabs("/m/analytics", storeId, paramsString)} label="Analytics" />

      {/* The store's own name, not "Analytics" — the prototype's own
          `o.s.name` in `.mtitle`. The window is the line beneath, alone: no
          day count, matching the prototype's `CD.rangeLabel()` with no
          further qualifier. */}
      <div>
        <h2 className="mtitle">{storeName}</h2>
        <p className="msub">{windowLabel}</p>
      </div>

      {/* Two cells: Net sales · Food cost — `h.phoneCells`, never a slice of
          `h.cells` (which carries four: Net sales, Orders, Avg ticket, Food
          cost, and only when an order count exists at all). */}
      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      {/* Shorter, no axis — `s.phoneChart`, the adapter's own. */}
      <Section title="Net sales" data={sections.sales} pending={pending}>
        {(s) => <Chart {...s.phoneChart} />}
      </Section>

      {/* Four days, newest first — `DayBook.phoneRows`, the adapter's own
          slice. See the file note above on why this page does not slice it. */}
      <Section title="The day book" meta="newest first" data={sections.dayBook} pending={pending}>
        {(b) => <MList rows={b.phoneRows.map(toDayRow)} />}
      </Section>
    </>
  )
}

/**
 * One day as one `.mli`: `[label, "<n> orders", money(net)]` — the
 * prototype's own three slots (`P.analyticsstore.phone()`'s `mlist` map).
 *
 * `net` and `ordersNote` both arrive pre-formatted off `DayBookRow` — this
 * function does no arithmetic and no number formatting, only the mapping to
 * `MListRow`'s field names. `ordersNote` is omitted, not blanked, on a day
 * with no order count at all (the adapter's own distinction between an
 * absence and a zero).
 *
 * No `href`: the day book is not a drill-down on this surface, and
 * `.mli.is-link` is set from `href` alone precisely so a row cannot advertise
 * a tap that does nothing.
 */
function toDayRow(row: DayBookRow): MListRow {
  return {
    key: row.key,
    title: row.date,
    detail: row.ordersNote ?? undefined,
    value: row.net,
  }
}
