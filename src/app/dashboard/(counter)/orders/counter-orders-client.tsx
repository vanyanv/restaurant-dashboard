"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  DateControl,
  Filters,
  Note,
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
import { rangeSubtitle, stepRange } from "@/lib/counter/date-range"
import { CHANNELS, type ChannelId } from "@/lib/counter/channels"
import type { OrdersList, OrdersRow, OrdersSections } from "@/lib/counter/adapters/orders"
import type { SectionSources } from "@/lib/counter/adapters/types"

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
 *
 * ## What this island receives, per section
 *
 * The resolved `SectionData` or the PROMISE of it (`SectionSources`).
 *
 * The page hands over promises — `Section` opens a Suspense boundary per
 * section and unwraps each with `use()`, so one slow query holds up one
 * section and nothing else. The union keeps the resolved half so this island
 * renders identically when it is handed finished data, which is what every
 * test of it does and what makes those tests worth anything.
 */
export type CounterOrdersSections = SectionSources<OrdersSections>

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

/**
 * The table's columns — and the ONE of them whose heading depends on the data.
 *
 * When not a single order in the matched range carries a marketplace fee, the
 * Fees column says so once, at its head, and its rows go quiet. It used to say
 * it once per row: `adjusted_commission`'s coverage was 0 of 6,360 marketplace
 * orders in August 2026, so about two rows in three printed "not recorded" in
 * `--warn` and the loudest thing on the page was a column of absences. A
 * marker true of every row separates no rows.
 *
 * A PARTLY covered range keeps the per-row marker, because there it is doing
 * the job it was written for: telling a reader which of two identical-looking
 * em dashes is "this channel takes nothing" and which is "the figure never
 * arrived".
 */
function columnsFor(list: OrdersList): Column[] {
  return [
    { key: "order", label: "Order" },
    { key: "time", label: "Time" },
    { key: "channel", label: "Channel" },
    { key: "items", label: "Items", numeric: true },
    { key: "ticket", label: "Ticket", numeric: true },
    { key: "fees", label: list.feesUnrecorded ? "Fees · none recorded" : "Fees", numeric: true },
    { key: "net", label: "Net", numeric: true },
  ]
}

/** The prototype's `v + ' orders'` (line 4871). Counts, not currency. */
const orderCount = (v: number) => `${v} order${v === 1 ? "" : "s"}`
/** The prototype's `bandFmt: function (v) { return v; }` — "4-week band 18–27". */
const bareCount = (v: number) => String(v)

/**
 * A fee nobody recorded, in the column where a fee would be.
 *
 * The same shape as the order page's `not costed` (prototype line 6587): a
 * WORD in a money column, coloured so it cannot be read as a figure. `--warn`
 * rather than `--bad` because nothing is wrong with the ORDER — the row is
 * fine and its fee has not arrived. `adjusted_commission`'s coverage ran 0 of
 * 6,360 marketplace orders in August 2026 against 5,908 of 6,094 in January,
 * so this is a sync gap, and the strip above says the same thing about the
 * range.
 *
 * The inline style names a token rather than a value, the same way `NotCosted`
 * and `Kv`'s tones do; `npm run tokens` matches hex, `oklch(`, `rgb(` and
 * `hsl(` literals and a `var()` is none of those.
 */
function NotRecorded() {
  return <span style={{ color: "var(--warn)" }}>not recorded</span>
}

function orderRows(rows: OrdersRow[], feesUnrecorded: boolean): Row[] {
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
      // Three states in one column, not two. `OrdersRow.fees` is an em dash
      // both when a channel took nothing and when its commission never
      // synced, and in a right-aligned money column those are indistinguishable
      // — so the second one says so in words. The phone has read
      // `feesRecorded` since the repair that discovered this; the desk, which
      // shows fifty rows to the phone's six, never did.
      // …unless the column heading has already said it for the whole range, in
      // which case the em dash `OrdersRow.fees` already carries is enough and
      // repeating the words fifty times is not.
      fees: r.feesRecorded || feesUnrecorded ? r.fees : <NotRecorded />,
      // The prototype paints every Net cell `hot`. It is not a verdict on the
      // row — `.tbl tbody tr[data-goto]:hover td.hot` is the only rule that
      // fires — it is the column the reader is following, lit on the row their
      // pointer is on. Emphasis, and it belongs to the composition rather than
      // to the adapter, because nothing about the FIGURE decided it.
      net: { v: r.net, cls: "hot" },
    },
  }))
}

/** The ⌘K palette's "Ask about Orders" group. Module-level, so the shell is
 *  not republished on every render of this page. */
const ASK_SUGGESTIONS = [
  "Which channel took the most orders in this range?",
  "What did the marketplaces charge me?",
  "Which hour is busiest, and is it normal?",
]

export function CounterOrdersClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  /**
   * The query string this page was rendered for, as PLAIN TEXT — not a
   * `URLSearchParams` instance. Props cross the RSC boundary as plain
   * serialisable values only; a `URLSearchParams` arrives on the client with
   * its prototype stripped, which a unit test that constructs this component
   * directly cannot see and a browser catches immediately.
   */
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterOrdersSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  // The one chrome fact this page has that its URL does not.
  usePageChrome({ askSuggestions: ASK_SUGGESTIONS })

  /*
   * The ONE transition shared with `AppShell`'s own store switcher — see
   * `counter-transition.tsx`. `pending` is threaded to every `<Section>`
   * below, and `startTransition` wraps this page's own `push` — the date
   * control, the channel toggles and the settled search — so a store change
   * from the rail and a filter change from this page mark the same `stale`.
   */
  const { pending, startTransition } = useCounterTransition()

  /*
   * The pending search write, cleared by the effect's own cleanup.
   *
   * `push` deliberately does NOT cancel it, and neither does it read the
   * params through a ref. Both were tried: both passed every test, because
   * `push` already re-creates itself whenever `params` changes and the effect
   * re-arms with it. Machinery nothing can measure is either dead or wrong,
   * and the cancel was wrong — changing the date range mid-word would have
   * thrown the half-typed word away instead of letting it settle into the
   * params that change just wrote. What actually fixes the race is
   * `committed`, below.
   */
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelSettle = useCallback(() => {
    if (settleRef.current !== null) {
      clearTimeout(settleRef.current)
      settleRef.current = null
    }
  }, [])

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

  const { range, presetId, comparisonId, channels, search } = counterParams
  const selectedStore = stores.find((s) => s.id === counterParams.storeId) ?? null
  const storeName = selectedStore?.name ?? "All stores"

  // The keystrokes, which are not the filter. `search` — the URL's own `q` —
  // stays the source of truth: whenever it changes under us (a shared link, a
  // back button, a Clear) the box is reseeded from it. See SEARCH_SETTLE_MS.
  const [draft, setDraft] = useState(search)
  // Read by `onToggle`, which must not re-create itself on every keystroke.
  const draftRef = useRef(draft)
  draftRef.current = draft

  /*
   * What we believe the URL's `q` is — which is NOT the same as `search`.
   *
   * `search` is the URL as it was when this render began, and a `router.push`
   * does not land synchronously. Comparing the draft against `search` meant
   * that immediately after Clear (draft "", `search` still "burger") the
   * effect saw a difference and armed one more write — on the pre-Clear
   * params — which put the cleared filters straight back 300ms later.
   *
   * Comparing against what we last COMMITTED closes that window: an explicit
   * action records its own search, so there is no difference left to settle.
   * The URL is still the source of truth — when `search` changes under us (a
   * shared link, the back button) both this and the box are reseeded from it.
   */
  const [committed, setCommitted] = useState(search)
  const [seeded, setSeeded] = useState(search)
  if (seeded !== search) {
    setSeeded(search)
    setDraft(search)
    setCommitted(search)
  }

  useEffect(() => {
    if (draft.trim() === committed) return
    settleRef.current = setTimeout(() => {
      settleRef.current = null
      setCommitted(draft.trim())
      push({ search: draft })
    }, SEARCH_SETTLE_MS)
    return cancelSettle
  }, [draft, committed, push, cancelSettle])

  const onToggle = useCallback(
    (id: string) => {
      const pressed = new Set<ChannelId>(channels)
      if (pressed.has(id as ChannelId)) pressed.delete(id as ChannelId)
      else pressed.add(id as ChannelId)
      // The half-typed word travels WITH the toggle. `push` cancels the
      // pending settle, so without this the draft would simply be thrown away
      // by pressing a channel — the reader would watch their own typing
      // vanish.
      const carry = draftRef.current.trim()
      setCommitted(carry)
      // Canonical CHANNELS order rather than press order, so two readers who
      // pressed the same two toggles end up holding the same link.
      push({
        channels: CHANNELS.filter((c) => pressed.has(c.id)).map((c) => c.id),
        ...(carry === search ? {} : { search: carry }),
      })
    },
    [channels, push, search],
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
    setCommitted("")
    push({ channels: [], search: "" })
  }, [push])

  return (
    /*
     * A FRAGMENT: the rail, the topbar, the store switcher and the ⌘K surface
     * are `(counter)/layout.tsx`'s now. Everything they used to be handed from
     * here is URL-driven and read there instead.
     */
    <>
      <PageHead
        // `P.orders.title` — the page's NAME. A list of orders is the same
        // document whatever window it is drawn over, and the window is the
        // next line down.
        title="Orders"
        // `R.head()`, the prototype's default sub: store · window · comparison.
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

      {/* Page level, above the first `.sec`, exactly as `strip([...])` is
          written in `P.orders.desk()`. Ruling O-R2: no cell here is judged
          against anything, because nothing in this schema publishes a
          per-order target, a fee ceiling or a ticket floor. */}
      <Section bare title="The figures" data={sections.strip} pending={pending}>
        {(cells) => <Strip cells={cells} />}
      </Section>

      {/* The prototype's own headless `.sec` — see the file note. */}
      <div className="sec">
        <Section bare title="Orders" data={sections.list} pending={pending}>
          {(l) => <OrdersTable list={l} draft={draft} onSearch={setDraft} onToggle={onToggle} onClear={filtering ? onClear : undefined} />}
        </Section>
      </div>

      <Section
        title="Orders by hour"
        pending={pending}
        /*
         * The baseline the band is drawn from, named by the ADAPTER: which
         * weekday it is made of is a fact about the range, not a page
         * decision, so `OrdersByHour` carries the string beside its chart.
         *
         * A FUNCTION, not `dataOf(sections.byHour)?.meta`. Since Task 3 this
         * section is a PROMISE — there is no resolved value in this file to
         * lift a string out of — so the qualifier is read inside `Section`,
         * where the value has landed. Still not a status branch: `Section`
         * gates `meta` on having data by itself, so the head is right in all
         * six states without this file knowing which one it is in.
         */
        meta={(h) => h.meta}
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
            <Note>
              This is the list. The shape of it &mdash; which channel, which hour, which way it is
              moving &mdash; is one page over.
            </Note>
            <div className="btnrow" style={{ marginTop: "10px" }}>
              <Link className="btn" href="/dashboard/analytics">
                Open analytics
              </Link>
            </div>
          </>
        )}
      </Section>
    </>
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
      <Table columns={columnsFor(list)} rows={orderRows(list.rows, list.feesUnrecorded)} />
    </>
  )
}
