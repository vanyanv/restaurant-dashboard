"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  DateControl,
  Drill,
  PageHead,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
  type Row,
  type SwitchableStore,
  SubNav,
} from "@/components/counter"
import { storeViewTabs } from "@/lib/counter/nav"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { count, money, pct } from "@/lib/counter/format"
import { dayCount, rangeSubtitle, stepRange, rangeLabel } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { AnalyticsSections, MixDrill } from "@/lib/counter/adapters/analytics"

/**
 * Counter Analytics on the desk, composed from `P.analytics.desk()`
 * (`docs/counter/counter-prototype.html:4894`) in the prototype's own order:
 *
 *   strip → the mix section, with its drill → a `.split` of the day of week
 *   and the hour of the day.
 *
 * A page composes primitives and calls exactly one adapter; it never imports
 * Prisma or an action directly and never inspects `SectionData.status`.
 * `Section` is the sole state renderer, `bare` for the strip, which is not a
 * `.sec` here.
 *
 * ## THIS FILE DOES NO ARITHMETIC, AND THAT IS THE POINT
 *
 * Every figure, caption, subtitle and sentence below is a field of the
 * adapter's payload. `/m/analytics` renders the same fields from the same call,
 * so the two surfaces cannot print two marketplace shares for one window. The
 * only strings this file writes are chrome — the page title, the range in the
 * subtitle, and the two `meta` qualifiers that describe the CHART rather than
 * the data in it.
 *
 * ## Three departures from the prototype, all deliberate
 *
 * 1. **The strip is three cells, not four.** A-R3: "Repeat guests" is gone,
 *    because the in-house channel carries no customer name at all (29,173
 *    orders, zero names) and the marketplace names that exist are a first name
 *    plus an initial, which collide by construction. `Strip` sizes itself from
 *    `cells.length`, so this is a shorter strip and not a fourth box reading
 *    "—". No placeholder is drawn for a figure this schema cannot produce.
 *
 * 2. **The mix section is titled "Channel mix", not the prototype's "Channel
 *    mix · share of net".** The suffix is the prototype's own subtitle written
 *    into its title, and on this page it is false twice over: the bands are a
 *    share of the FOUR CHANNELS (A-R2 — caviar and chownow are outside both
 *    the bands and their denominator), and "net" on this page already names a
 *    different figure, the $48,425 the strip's first cell prints. The adapter
 *    publishes `subtitle` precisely to name the denominator out loud, and it
 *    is rendered as this section's `meta` one line below the title. A head
 *    that said "share of net" above a subtitle saying "share of the four
 *    channels, not dollars" would contradict itself in two lines. The phone
 *    surface titles the same section "Channel mix" already.
 *
 * 3. **No dashed average-day rule on the weekday chart, and no note about
 *    one.** The prototype draws `rule: { v: mean, label: 'Average day' }` and
 *    its section meta explains the dashed line. `buildWeekday` publishes no
 *    rule, so a meta naming one would point at something that is not on the
 *    screen. The comparison against the mean is in the adapter's own sentence
 *    under the chart instead, in words.
 */

/** The shapes `page.tsx` hands this island — the adapter's own, imported rather than restated. */
export type CounterAnalyticsSections = SectionSources<AnalyticsSections>

/** A share, on a chart whose readings are already 0..100. */
const share = (v: number) => pct(v, { scaled: true })

/** An hour's order count. `fmt` defaults to `money()`; unpassed, 284 orders would read "$284". */
const orders = (v: number) => `${Math.round(v)} order${Math.round(v) === 1 ? "" : "s"}`

const MIX_COLUMNS: Column[] = [
  { key: "channel", label: "Channel" },
  { key: "was", label: "First third", numeric: true },
  { key: "now", label: "Last third", numeric: true },
  { key: "change", label: "Change", numeric: true },
  { key: "commission", label: "Commission", numeric: true },
]

/**
 * The mix-move table. `hot` on the change cell is the prototype's own
 * emphasis for a move that went the expensive way — the adapter decides
 * which, because that is a judgement about the rate a channel charges.
 */
function mixRows(drill: MixDrill): Row[] {
  return drill.rows.map((r) => ({
    key: r.key,
    cells: {
      channel: <b>{r.channel}</b>,
      was: r.was,
      now: r.now,
      change: { v: r.change, cls: r.costly ? "hot" : undefined },
      commission: r.commission,
    },
  }))
}

/** The ⌘K palette's "Ask about Analytics" group. Module-level, so the shell is
 *  not republished on every render of this page. */
const ASK_SUGGESTIONS = [
  "Which channel is costing the most to sell through?",
  "Is the marketplace share still rising?",
  "When should the extra hands be on?",
]

export function CounterAnalyticsClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  /**
   * The query string this page was rendered for, as PLAIN TEXT — not a
   * `URLSearchParams` instance. Props cross the RSC boundary as plain
   * serialisable values only; an instance arrives on the client with its
   * prototype stripped.
   */
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterAnalyticsSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  usePageChrome({ askSuggestions: ASK_SUGGESTIONS })

  // The ONE transition shared with `AppShell`'s own store switcher, so a store
  // change from the rail and a range change from the date control mark the
  // same `stale`.
  const { pending, startTransition } = useCounterTransition()

  const push = useCallback(
    (next: Parameters<typeof writeCounterParams>[1]) => {
      const nextParams = writeCounterParams(params, next)
      const qs = nextParams.toString()
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      })
    },
    [params, pathname, router, startTransition],
  )

  const { range, presetId, comparisonId } = counterParams
  const selectedStore = stores.find((s) => s.id === counterParams.storeId) ?? null
  const storeName = selectedStore?.name ?? "All stores"
  // The window named by its ENDS, as every other Counter page names it.
  const windowLabel = rangeLabel(range, "custom")
  const days = dayCount(range)

  return (
    /* A FRAGMENT: the rail, the topbar, the store switcher and the ⌘K surface
       belong to `(counter)/layout.tsx`. */
    <>
      <PageHead
        title="Analytics"
        sub={rangeSubtitle(storeName, range, comparisonId)}
      >
        <DateControl
          presetId={presetId}
          comparisonId={comparisonId}
          range={range}
          onPreset={(id) => push({ presetId: id })}
          onComparison={(id) => push({ comparisonId: id })}
          onStep={(direction) => push({ range: stepRange(range, direction) })}
          onRange={(next) => push({ range: next })}
        />
      </PageHead>

      {/* `VIEWS`'s group/store pair — see `storeViewTabs`. "One store" appears
          only once a store is picked, which is the design's own sequence. */}
      <SubNav items={storeViewTabs("/dashboard/analytics", counterParams.storeId, paramsString)} label="Analytics" />

      {/* Page level, above the first `.sec`, as `P.analytics.desk()` writes it.
          Three cells (A-R3). The second carries a quiet `Bullet` — `Figure`
          draws it from the cell's own `reference`, so the page does not have
          to know which cell is judged against what. */}
      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      {/* One chart, one relationship. Dollars per channel live on the Overview;
          what belongs here is whether the mix is MOVING — which is why the
          bands are drawn as share and the subtitle says so. */}
      <Section
        title="Channel mix"
        pending={pending}
        // The adapter's, not the page's: the denominator is a fact about the
        // data (A-R2), and `/m/analytics` prints the same line.
        meta={(m) => m.subtitle}
        data={sections.mix}
        askAbout="the channel mix"
      >
        {(m) => (
          <>
            <Chart {...m.chart} fmt={share} />
            <Drill label="How the mix moved, and what it cost">
              {m.drill.enough ? (
                <>
                  <Table columns={MIX_COLUMNS} rows={mixRows(m.drill)} />
                  <p className="shift">{m.drill.note}</p>
                </>
              ) : (
                /* A-R10: below three buckets there is no first third and no
                   last third. The paragraph IS the body — a four-column table
                   of zeroes would be a fabricated drift presented as a
                   measurement. */
                <p className="shift">{m.drill.note}</p>
              )}
            </Drill>
          </>
        )}
      </Section>

      <div className="split">
        <Section
          title="By day of week"
          pending={pending}
          meta={`${windowLabel} · ${count(days)} days, averaged by weekday`}
          data={sections.weekday}
          askAbout="which day of the week sells best"
        >
          {(w) => (
            <>
              <Chart {...w.chart} fmt={(v) => money(v)} />
              {/* The caveat rides in the same paragraph the prototype puts it
                  in, and it is null on a range wide enough not to need it. */}
              <p className="mono">
                {w.sentence}
                {w.note ? ` ${w.note}` : null}
              </p>
            </>
          )}
        </Section>

        <Section
          title="When the orders come"
          pending={pending}
          // A-R5: this counts orders from the HOURLY table and says so, because
          // the hourly rollup and the daily summaries disagree by 1.5% for the
          // same window. The adapter writes that caption for the same reason.
          meta={(s) => s.meta}
          data={sections.service}
          askAbout="when the orders come in"
        >
          {(s) => (
            <>
              <Chart {...s.chart} fmt={orders} />
              <p className="mono">{s.sentence}</p>
            </>
          )}
        </Section>
      </div>
    </>
  )
}
