"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import { useRouter } from "next/navigation"
import {
  AppShell,
  Chart,
  DateControl,
  Filters,
  Section,
  Strip,
  Table,
  type Column,
  type RailUser,
  type Row,
  type SwitchableStore,
} from "@/components/counter"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { rangeSubtitle, stepRange } from "@/lib/counter/date-range"
import { dataOf } from "@/lib/counter/section-data"
import { CHANNELS, type ChannelId } from "@/lib/counter/channels"
import type { OrdersList, OrdersRow, OrdersSections } from "@/lib/counter/adapters/orders"

/**
 * Counter Orders — the desk list, composed from `P.orders.desk()`
 * (`docs/counter/counter-prototype.html:4852`) in the prototype's own order:
 *
 *   strip([...five cells])                        page level, above any .sec
 *   <div class="sec">.filters + tbl(...)</div>    a .sec with NO .sec__head
 *   sec('Orders by hour', meta, chart + p + btn)
 *
 * A page composes primitives and calls exactly one adapter; it never imports
 * Prisma or an action directly and never inspects `SectionData.status` —
 * `npm run tokens` fails the build on either. `Section` is the sole state
 * renderer, `bare` for the two blocks that are not a `.sec__head`-bearing
 * section here.
 *
 * ## The list section has no head, deliberately
 *
 * The prototype opens the list with a bare `<div class="sec">`: no
 * `.sec__head`, no `<h3>`, no `.k`. There is nothing for a heading to say that
 * the page title and the filter bar's own count do not already say, and
 * `.sec__head` is a LANDMARK the fidelity gate counts — an extra one is never
 * forgiven (ruling F-R8). So this block wraps `Section bare` in the
 * prototype's own `<div class="sec">`: the same six states, the same five
 * state components, inside the box the design draws, with no head grown on
 * top of it. `bare` also drops `.sec__body`, which is right — `.filters`
 * brings its own padding and `Table` fills the section edge to edge, exactly
 * as `tbl()` does in the prototype.
 *
 * ## Why `list` never goes empty, and why that is the right call
 *
 * `buildOrdersList` returns a READY list with zero rows when a filter matches
 * nothing — never `empty("no_match")`. That looks like a missing state and is
 * not one. The filter bar lives INSIDE this section, so an empty state would
 * replace the bar along with the rows: the reader whose search just failed
 * would lose the search box that failed, the toggles that narrowed it and the
 * Clear affordance that would widen it again, and be left with a grey panel
 * and a back-out. An empty state has to leave the reader somewhere to go, and
 * here the way out IS the thing the empty state would delete. So a search that
 * matches nothing renders the `.filters` bar with an empty `Table` under it —
 * the count reads "0 of 0", the Clear button is showing, and one press
 * restores the list.
 *
 * (The prototype has no zero-row state at all, because its ORDERS array is a
 * literal. This is the composition's answer to a case the design never drew.)
 *
 * ## What the prototype has here and this page does not
 *
 * - **A next page of orders.** `OrdersList.nextCursor` is carried through the
 *   adapter and is deliberately not rendered: the prototype's list is eight
 *   literal rows with nothing under them, and a pager would be a landmark the
 *   design never drew. The window above is what changes how much is in the
 *   list.
 * - **A fifth toggle.** Four `CHANNELS`, always all four, whatever slugs this
 *   account has actually traded on — see `buildToggles`.
 * - **An "Ask about this" button on either block.** `sec()`'s fourth argument
 *   is what emits `.askmini`, and `P.orders.desk()` passes it on NEITHER
 *   section — unlike `P.pnl.desk()`, which passes `true` on two of its five
 *   and nothing on the rest. The prototype decides which sections have a
 *   question worth asking; this page follows it rather than adding one, and
 *   the ⌘K surface still carries this page's own three suggestions.
 * - **A "Try again" button on a failed section.** `onRetry` is what makes
 *   `Failed` draw one, and `.btn` is a landmark the prototype does not have
 *   here. No Counter page passes one yet; when one does it will be every page
 *   at once.
 */
export type CounterOrdersSections = OrdersSections

/**
 * How long the search box waits before it writes what was typed into the URL.
 *
 * The filter state lives in the URL and not in this component — that is what
 * makes a filtered list survive a reload and travel in a link. The one thing
 * that CANNOT live there is the half-typed word: a controlled input whose
 * value is the query string re-renders from the server on every keystroke,
 * which drops characters and puts a round trip between the reader and their
 * own typing. So the box holds the keystrokes, the URL holds the filter, and
 * this is how long the first waits before becoming the second.
 */
const SEARCH_SETTLE_MS = 300

const COLUMNS: Column[] = [
  { key: "order", label: "Order" },
  { key: "time", label: "Time" },
  { key: "channel", label: "Channel" },
  { key: "items", label: "Items", numeric: true },
  { key: "ticket", label: "Ticket", numeric: true },
  { key: "fees", label: "Fees", numeric: true },
  { key: "net", label: "Net", numeric: true },
]

/** The prototype's `v + ' orders'` (line 4871). Counts, not currency. */
const orderCount = (v: number) => `${v} order${v === 1 ? "" : "s"}`
/** The prototype's `bandFmt: function (v) { return v; }` — "4-week band 18–27". */
const bareCount = (v: number) => String(v)

function orderRows(rows: OrdersRow[]): Row[] {
  return rows.map((r) => ({
    key: r.key,
    href: r.href,
    ariaLabel: `Open order ${r.id}`,
    cells: {
      order: r.id,
      time: r.time,
      // `<span class="chip" style="--pc:var(--ch-dd)"><i></i>DoorDash</span>`
      // — the prototype's own mark-beside-a-label, never colour alone.
      channel: (
        <span className="chip" style={{ "--pc": r.channel.tint } as CSSProperties}>
          <i />
          {r.channel.label}
        </span>
      ),
      items: r.items,
      ticket: r.ticket,
      fees: r.fees,
      // The prototype paints every Net cell `hot`. It is not a verdict on the
      // row — `.tbl tbody tr[data-goto]:hover td.hot` is the only rule that
      // fires — it is the column the reader is following, lit on the row their
      // pointer is on. Emphasis, and it belongs to the composition rather than
      // to the adapter, because nothing about the FIGURE decided it.
      net: { v: r.net, cls: "hot" },
    },
  }))
}

export function CounterOrdersClient({
  pathname,
  params: paramsString,
  stores,
  user,
  today,
  sections,
}: {
  pathname: string
  /**
   * The query string this page was rendered for, as PLAIN TEXT — not a
   * `URLSearchParams` instance. Props cross the RSC boundary as plain
   * serialisable values only; a `URLSearchParams` arrives on the client with
   * its prototype stripped, which a unit test that constructs this component
   * directly cannot see and a browser catches immediately.
   */
  params: string
  stores: SwitchableStore[]
  user: RailUser
  today: Date
  sections: CounterOrdersSections
}) {
  const router = useRouter()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  const push = useCallback(
    (next: Parameters<typeof writeCounterParams>[1]) => {
      const nextParams = writeCounterParams(params, next)
      const qs = nextParams.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [params, pathname, router],
  )

  const { range, presetId, comparisonId, channels, search } = counterParams
  const selectedStore = stores.find((s) => s.id === counterParams.storeId) ?? null
  const storeName = selectedStore?.name ?? "All stores"

  // The keystrokes, which are not the filter. `search` — the URL's own `q` —
  // stays the source of truth: whenever it changes under us (a shared link, a
  // back button, a Clear) the box is reseeded from it. See SEARCH_SETTLE_MS.
  const [draft, setDraft] = useState(search)
  const [seeded, setSeeded] = useState(search)
  if (seeded !== search) {
    setSeeded(search)
    setDraft(search)
  }

  useEffect(() => {
    if (draft.trim() === search) return
    const t = setTimeout(() => push({ search: draft }), SEARCH_SETTLE_MS)
    return () => clearTimeout(t)
  }, [draft, search, push])

  const onToggle = useCallback(
    (id: string) => {
      const pressed = new Set<ChannelId>(channels)
      if (pressed.has(id as ChannelId)) pressed.delete(id as ChannelId)
      else pressed.add(id as ChannelId)
      // Canonical CHANNELS order rather than press order, so two readers who
      // pressed the same two toggles end up holding the same link.
      push({ channels: CHANNELS.filter((c) => pressed.has(c.id)).map((c) => c.id) })
    },
    [channels, push],
  )

  /*
   * Clear deselects EVERY toggle and empties the box. It never selects all
   * four — those are different filters. No toggle pressed is no platform
   * filter at all, so an order on a slug with no Counter channel (`chownow`)
   * is in the list; all four pressed is `platform IN (…)`, which drops exactly
   * those orders. See `writeCounterParams`.
   */
  const filtering = channels.length > 0 || search !== ""
  const onClear = useCallback(() => {
    setDraft("")
    push({ channels: [], search: "" })
  }, [push])

  return (
    <AppShell
      pathname={pathname}
      params={params}
      // `P.orders.title` — the page's NAME. A list of orders is the same
      // document whatever window it is drawn over, and the window is the next
      // line down.
      title="Orders"
      // `R.head()`, the prototype's default sub: store · window · comparison.
      sub={rangeSubtitle(storeName, range, comparisonId)}
      actions={
        <DateControl
          presetId={presetId}
          comparisonId={comparisonId}
          range={range}
          onPreset={(id) => push({ presetId: id })}
          onComparison={(id) => push({ comparisonId: id })}
          onStep={(direction) => push({ range: stepRange(range, direction) })}
          onRange={(next) => push({ range: next })}
        />
      }
      stores={stores}
      selectedStoreId={counterParams.storeId}
      onSelectStore={(id) => push({ storeId: id })}
      storeName={selectedStore?.name ?? null}
      user={user}
      today={today}
      presetId={presetId}
      onSelectPreset={(id) => push({ presetId: id })}
      askSuggestions={[
        "Which channel took the most orders in this range?",
        "What did the marketplaces charge me?",
        "Which hour is busiest, and is it normal?",
      ]}
    >
      {/* Page level, above the first `.sec`, exactly as `strip([...])` is
          written in `P.orders.desk()`. Ruling O-R2: no cell here is judged
          against anything, because nothing in this schema publishes a
          per-order target, a fee ceiling or a ticket floor. */}
      <Section bare title="The figures" data={sections.strip}>
        {(cells) => <Strip cells={cells} />}
      </Section>

      {/* The prototype's own headless `.sec` — see the file note. */}
      <div className="sec">
        <Section bare title="Orders" data={sections.list}>
          {(l) => <OrdersTable list={l} draft={draft} onSearch={setDraft} onToggle={onToggle} onClear={filtering ? onClear : undefined} />}
        </Section>
      </div>

      <Section
        title="Orders by hour"
        /*
         * The baseline the band is drawn from, named by the ADAPTER: which
         * weekday it is made of is a fact about the range, not a page
         * decision, so `OrdersByHour` carries the string beside its chart.
         *
         * `Section.meta` is a prop rather than something the body can set, so
         * the value has to be lifted out here — `dataOf` reads it or gets
         * null, which is not a status branch: `Section` gates `meta` on
         * having data by itself, so the head is right in all six states
         * without this file knowing which one it is in.
         */
        meta={dataOf(sections.byHour)?.meta}
        data={sections.byHour}
      >
        {(h) => (
          <>
            {/* `fmt` and `bandFmt` are the CHART's props, not the spec's, and
                `fmt` defaults to `money()`. Unpassed, an hour that took 22
                orders would read "$22" and its band "$18–$27" — a wrong
                figure, not a cosmetic slip. */}
            <Chart {...h.chart} fmt={orderCount} bandFmt={bareCount} />
            {/* The two pieces of page furniture the adapter does not carry,
                because neither is a figure: the prototype's own closing
                sentence and the way to the page it names (line 4874). */}
            <p className="mono" style={{ margin: "12px 0 0" }}>
              This is the list. The shape of it &mdash; which channel, which hour, which way it is
              moving &mdash; is one page over.
            </p>
            <div className="btnrow" style={{ marginTop: "10px" }}>
              <Link className="btn" href="/dashboard/analytics">
                Open analytics
              </Link>
            </div>
          </>
        )}
      </Section>
    </AppShell>
  )
}

/**
 * The filter bar and the table it filters, in that order — one block, because
 * the count in the bar is the table's own.
 */
function OrdersTable({
  list,
  draft,
  onSearch,
  onToggle,
  onClear,
}: {
  list: OrdersList
  draft: string
  onSearch: (next: string) => void
  onToggle: (id: string) => void
  onClear?: () => void
}) {
  return (
    <>
      <Filters
        search={draft}
        // The prototype's own placeholder and label, at line 4858.
        searchPlaceholder="Order ID, customer, item"
        searchLabel="Search orders"
        onSearch={onSearch}
        toggles={list.toggles}
        onToggle={onToggle}
        onClear={onClear}
        count={list.count}
      />
      <Table columns={COLUMNS} rows={orderRows(list.rows)} />
    </>
  )
}
