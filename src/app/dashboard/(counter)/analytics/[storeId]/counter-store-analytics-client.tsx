"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  DateControl,
  MoneyLines,
  PageHead,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
  type Row,
  type SwitchableStore,
} from "@/components/counter"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { money, pct } from "@/lib/counter/format"
import { rangeSubtitle, rangeLabel, stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
  CategoryTable,
  DayBook,
  StoreAnalyticsSections,
  TopItems,
} from "@/lib/counter/adapters/analytics"

/**
 * One store's Analytics on the desk, composed from `P.analyticsstore.desk()`
 * (`docs/counter/counter-prototype.html:7589`) in the prototype's own order:
 *
 *   the store note → strip → a `.split` of net sales and the hourly shape →
 *   a `.split` of the channel mix and the top items → the day book →
 *   a `.split` of the statement and the categories.
 *
 * A page composes primitives and calls exactly one adapter; it never imports
 * Prisma or an action directly and never inspects `SectionData.status`.
 * `Section` is the sole state renderer, `bare` for the strip, which is not a
 * `.sec` here.
 *
 * ## THIS FILE DOES NO ARITHMETIC EITHER
 *
 * The same rule `counter-analytics-client.tsx` states, and it binds harder
 * here because three of these sections are about cost. Every figure below is a
 * field of the adapter's payload — including the day book's Food, Labor and
 * Prime, which come off `Statement`'s own per-period `6100`/`6200` rows
 * through `prime-cost.ts` (A-R11). The page does not add food to labour and it
 * does not divide by anything: the day book's prime cost and the P&L's prime
 * cost are one function over one set of rows.
 *
 * That is also why a day with no COGS posted reads "—" here rather than "0%".
 * The em-dash is the adapter's, per figure, on that day's own rows. A zero
 * would be the claim that the food was free.
 *
 * ## Three departures from the prototype, all deliberate
 *
 * 1. **The statement's six lines are the rollup's, not the prototype's.**
 *    `P.analyticsstore.desk()` prints labour as `net * 0.248` and fixed costs
 *    as `425.42 * days`; both are its fixtures. `buildStoreStatement` publishes
 *    `laborValue`, `commissions` and `occupancy + otherOperating` as
 *    `getAllStoresPnL` charged them to this range, and the EBITDA line is
 *    `bottomLine` rather than a margin applied to sales.
 *
 * 2. **The day book lists EVERY day in range, newest first** — the prototype
 *    slices its last six. A range is what the reader chose; a table that
 *    silently dropped the rest of it would make the days it does show look
 *    like the days there were. The count is in the section's own meta.
 *
 * 3. **"Top items" carries the prototype's four columns** (Item · Units ·
 *    Margin · Contribution) and not the category the adapter also publishes on
 *    each row. Half of a `.split` is not wide enough for five numeric columns,
 *    and the category question is answered whole by the table directly below
 *    the statement.
 *
 * ## The title says "Analytics", and the store name is in the subtitle
 *
 * The prototype titles this page `<store> analytics`. Here the sub already
 * reads "Chris N Eddys - Hollywood · Aug 20 – Aug 26 · Same days last week"
 * through `rangeSubtitle` — the same line the group page writes — so a title
 * carrying the name too would print it twice above one strip. The store
 * instead names the breadcrumb's leaf and the rail's selected store, through
 * `usePageChrome`: there is no `?store=` on this route for the layout to read
 * one out of.
 */

/** The shapes `page.tsx` hands this island — the adapter's own, imported rather than restated. */
export type CounterStoreAnalyticsSections = SectionSources<StoreAnalyticsSections>

/** A share, on a chart whose readings are already 0..100. */
const share = (v: number) => pct(v, { scaled: true })

/** An hour's order count. `fmt` defaults to `money()`; unpassed, 284 orders would read "$284". */
const orders = (v: number) => `${Math.round(v)} order${Math.round(v) === 1 ? "" : "s"}`

/**
 * The day book. Seven columns, and the only painted cell on the page is Prime
 * — `over` is the adapter's judgement against the trade's published ceiling,
 * because deciding what "too high" means is not a page's decision to make.
 */
const DAY_BOOK_COLUMNS: Column[] = [
  { key: "date", label: "Date" },
  { key: "net", label: "Net", numeric: true },
  { key: "orders", label: "Orders", numeric: true },
  { key: "ticket", label: "Ticket", numeric: true },
  { key: "food", label: "Food", numeric: true },
  { key: "labor", label: "Labor", numeric: true },
  { key: "prime", label: "Prime", numeric: true },
]

function dayBookRows(book: DayBook): Row[] {
  return book.rows.map((r) => ({
    key: r.key,
    cells: {
      date: <b>{r.date}</b>,
      net: r.net,
      orders: r.orders,
      ticket: r.ticket,
      food: r.food,
      labor: r.labor,
      prime: { v: <b>{r.prime}</b>, cls: r.over ? "hot" : undefined },
    },
  }))
}

const ITEM_COLUMNS: Column[] = [
  { key: "name", label: "Item" },
  { key: "qty", label: "Units", numeric: true },
  { key: "margin", label: "Margin", numeric: true },
  { key: "contribution", label: "Contribution", numeric: true },
]

function itemRows(items: TopItems): Row[] {
  return items.rows.map((r) => ({
    key: r.key,
    cells: {
      name: <b>{r.name}</b>,
      qty: r.qty,
      margin: r.margin,
      contribution: r.contribution,
    },
  }))
}

const CATEGORY_COLUMNS: Column[] = [
  { key: "name", label: "Category" },
  { key: "net", label: "Net", numeric: true },
  { key: "share", label: "Share", numeric: true },
  { key: "food", label: "Food", numeric: true },
]

function categoryRows(categories: CategoryTable): Row[] {
  return categories.rows.map((r) => ({
    key: r.key,
    cells: {
      name: <b>{r.name}</b>,
      net: r.net,
      share: r.share,
      food: r.food,
    },
  }))
}

/** The ⌘K palette's "Ask about Analytics" group — this page's own three questions. */
const ASK_SUGGESTIONS = [
  "Which day in this range ran the highest prime cost?",
  "What is this store keeping after food, labour and fees?",
  "Which categories carry this store?",
]

export function CounterStoreAnalyticsClient({
  params: paramsString,
  storeId,
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
  /** The PATH's store — what scopes this page. There is no `?store=` here. */
  storeId: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterStoreAnalyticsSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  const store = stores.find((s) => s.id === storeId) ?? null
  // `page.tsx` 404s on a store the switcher does not list, so this fallback is
  // for a store list that failed to load rather than for a wrong id.
  const storeName = store?.name ?? "This store"

  // The store is published upward because the URL cannot say it: the rail
  // reads `?store=` and there is none on this route, so without this the
  // switcher would show "All stores" on a page about one.
  usePageChrome({
    leaf: storeName,
    storeId,
    storeName,
    askSuggestions: ASK_SUGGESTIONS,
  })

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
  // The window named by its ENDS, as every other Counter page names it.
  const windowLabel = rangeLabel(range, "custom")

  return (
    /* A FRAGMENT: the rail, the topbar, the store switcher and the ⌘K surface
       belong to `(counter)/layout.tsx`. */
    <>
      <PageHead title="Analytics" sub={rangeSubtitle(storeName, range, comparisonId)}>
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

      {/* The prototype's `storeNote()` and its strip, in one block above the
          first `.sec`. The note is the adapter's — it states what this route
          adds to the group page, and it is one sentence rather than a second
          page-level heading. */}
      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => (
          <>
            <p className="mono" style={{ margin: "0 0 12px" }}>
              {h.note}
            </p>
            <Strip cells={h.cells} />
          </>
        )}
      </Section>

      <div className="split">
        <Section
          title="Net sales"
          pending={pending}
          meta={windowLabel}
          data={sections.sales}
          askAbout="how this store's sales moved"
        >
          {(s) => <Chart {...s.chart} fmt={(v) => money(v)} />}
        </Section>

        <Section
          title="When the orders come"
          pending={pending}
          // A-R5: the adapter's caption, because this counts orders from the
          // HOURLY table and the daily summaries answer 1.5% differently for
          // the same window. It is never read against a figure elsewhere on
          // this page.
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

      <div className="split">
        <Section
          title="By channel"
          pending={pending}
          // The adapter's, not the page's: the bands are a share of the FOUR
          // channels (A-R2), and the group page prints the same line.
          meta={(m) => m.subtitle}
          data={sections.mix}
          askAbout="the channel mix at this store"
        >
          {(m) => <Chart {...m.chart} fmt={share} />}
        </Section>

        <Section
          title="Top items"
          pending={pending}
          // The coverage is part of the reading: the classifier only sees items
          // with a costed recipe, and a table that did not say so would present
          // a partial menu as the menu.
          meta={(i) => i.meta}
          data={sections.items}
          pad={false}
          askAbout="which items carry this store"
        >
          {(i) => <Table columns={ITEM_COLUMNS} rows={itemRows(i)} />}
        </Section>
      </div>

      {/* The section the group page cannot draw three times over. */}
      <Section
        title="The day book"
        pending={pending}
        meta={(b) => b.meta}
        data={sections.dayBook}
        pad={false}
        askAbout="how the days in this range compare"
      >
        {(b) => <Table columns={DAY_BOOK_COLUMNS} rows={dayBookRows(b)} />}
      </Section>

      <div className="split">
        <Section
          title="The statement"
          pending={pending}
          meta={(s) => s.meta}
          data={sections.statement}
          askAbout="what this store keeps"
        >
          {(s) => <MoneyLines rows={s.rows} />}
        </Section>

        <Section
          title="By category"
          pending={pending}
          meta={(c) => c.meta}
          data={sections.categories}
          pad={false}
          askAbout="which categories carry this store"
        >
          {(c) => <Table columns={CATEGORY_COLUMNS} rows={categoryRows(c)} />}
        </Section>
      </div>
    </>
  )
}
