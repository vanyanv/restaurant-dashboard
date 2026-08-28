"use client"

import { Suspense, use } from "react"
import { MList, MStrip, Section, useCounterTransition, type MListRow } from "@/components/counter"
import { dataOf, isPendingSource, type SectionSource } from "@/lib/counter/section-data"
import type { OrdersRow, OrdersSections, StripCell } from "@/lib/counter/adapters/orders"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * Counter Orders — the phone.
 *
 * `P.orders.phone()` at line 4880 of `docs/counter/counter-prototype.html`,
 * composed in its order and stopping where it stops:
 *
 *   `.mtitle` / `.msub` → a two-cell `mstrip` → `sec('Latest', …, mlist(…))`
 *
 * It calls the SAME adapter the desk calls (`getOrdersSections`), through the
 * same `readCounterParams`, so no figure here can disagree with the same
 * figure on `/dashboard/orders`: they are the same rollup read through the
 * same `SectionData`.
 *
 * ## The phone is a route, not a breakpoint
 *
 * `src/proxy.ts` rewrites `/dashboard/orders` to `/m/orders` on a phone
 * user agent, so THIS is what a phone renders and what `npm run fidelity`'s
 * `fidelity-mobile` project measures against `P.orders.phone()`. A screenshot
 * of `/dashboard/orders` at 390px photographs the desk squeezed and says
 * nothing about this file.
 *
 * ## What the phone drops, and it is the prototype that drops it
 *
 * | Desk | Phone |
 * |---|---|
 * | `.strip`, five cells | `.mstrip`, two cells |
 * | the `.filters` bar — search, four toggles, Clear, the count | — |
 * | the seven-column `.tbl` over a screenful of orders | six rows of `.mlist` |
 * | `sec('Orders by hour', …)` — the chart, the closing line, the button | — |
 *
 * The filter bar is the one worth naming, because `OrdersList` still carries
 * `toggles` and `search` and it would be one line to draw them. It is not
 * drawn. `P.orders.phone()` has no `.filters` and no `.togs`, and an extra
 * landmark is never forgiven (ruling F-R8). The window in `.mtop` is the one
 * control a phone reader gets over what is in this list, which is the same
 * trade every other phone surface in this design makes.
 *
 * ## The sub is the strip's own two figures
 *
 * `Math.round(R.orderTotal()).toLocaleString() + ' orders · ' + USD(R.netTotal())`
 * — the ORDER COUNT and the NET for the whole matched range, which are cells
 * 1 and 2 of the strip the adapter already built. Reading them off
 * `sections.strip` rather than counting `list.rows` is the point: `rows` is
 * one screenful and the strip covers the range, so a sub summed off the list
 * would read "6 orders" on a 187-order day.
 *
 * `dataOf` is the sanctioned accessor for exactly this — it is not a status
 * branch, and a strip that did not load leaves the title with no sub rather
 * than printing " orders · ".
 *
 * Since Task 3 the strip arrives as a PROMISE, so the sub reads it inside its
 * own tiny Suspense boundary (`OrdersSub`) rather than off a resolved object.
 * Its fallback is `null` — which is exactly what this line already rendered
 * for a strip that had not loaded, so the title stands alone for a beat and
 * the sub appears under it. The alternative was to await the strip in the page
 * and hold the whole list behind it for one sentence.
 *
 * ## No arithmetic on `discount` or `commission`, anywhere on this page
 *
 * Both columns are stored as signed deductions. `src/lib/counter/order-signs.ts`
 * owns that convention and the adapter has already applied it: `OrdersRow.net`
 * IS `ticket + commission` and `OrdersRow.fees` IS `feeAmount()`, both
 * formatted. Every figure below is printed, never computed.
 */
export function CounterPhoneOrdersClient({
  sections,
}: {
  sections: SectionSources<OrdersSections>
}) {
  /*
   * This page has no filter bar (see the file note) and no `push` of its own
   * — the range and the store are `PhoneShell`'s. `pending` is that same
   * transition, threaded to every `<Section>` below so a range or store
   * change reads as `stale` rather than a blank `loading.tsx`. See
   * `counter-transition.tsx`.
   */
  const { pending } = useCounterTransition()

  return (
    /*
     * A FRAGMENT. `.ct-root.ct-phone`, `.mtop` and `.mscroll` are
     * `src/app/(mobile)/m/(counter)/layout.tsx`'s now, mounted once for all
     * four rebuilt `/m` routes instead of rebuilt by every one of them. What
     * is rendered here is what goes INSIDE `.mscroll`, unchanged.
     */
    <>
      {/* The page's NAME — a list of orders is the same document whatever
          window it is drawn over, and the window is in `.mtop` one element
          up, along with the store. */}
      <div>
        <h2 className="mtitle">Orders</h2>
        <Suspense fallback={null}>
          <OrdersSub strip={sections.strip} />
        </Suspense>
      </div>

      {/* Two cells, chosen by NAME out of the adapter's five. Nothing here
          is judged — ruling O-R2 — so no cell carries a reference and the
          phone draws no bullet and no band. */}
      <Section bare title="The figures" data={sections.strip} pending={pending}>
        {(cells) => <MStrip cells={phoneCells(cells)} />}
      </Section>

      {/* `sec('Latest', '8 shown', mlist(ORDERS.slice(0, 6), 'order'))`. No
          filter bar above it and no pager below it — see the file note.

          The meta is a FUNCTION of the list because it is a claim ABOUT the
          list: the prototype's `'8 shown'` is a literal beside a six-row list,
          and ours says what it actually showed. `Section` calls it once the
          value is in hand, which is the only place that count exists. */}
      <Section
        title="Latest"
        pending={pending}
        meta={(l) => `${Math.min(l.rows.length, PHONE_ROWS)} shown`}
        data={sections.list}
      >
        {(l) => <MList rows={l.rows.slice(0, PHONE_ROWS).map(toListRow)} />}
      </Section>
    </>
  )
}

/**
 * The two figures under the page title: the ORDER COUNT and the NET for the
 * whole matched range, read off the strip the adapter already built.
 *
 * Its own component because it `use()`s a promise, and a Suspense boundary
 * only catches what renders inside it — calling `use()` in the island itself
 * would suspend the whole page and put the list behind the sub-line. It reads
 * data and never a status: `dataOf` is the sanctioned accessor and gives null
 * for every state that has no figures, which renders nothing at all.
 */
function OrdersSub({ strip }: { strip: SectionSource<StripCell[]> }) {
  const figures = dataOf(isPendingSource(strip) ? use(strip) : strip)
  const orders = cellValue(figures, "Orders")
  const netSales = cellValue(figures, "Net sales")
  if (!orders || !netSales) return null
  return (
    <p className="msub">
      {orders} orders &middot; {netSales}
    </p>
  )
}

/**
 * `ORDERS.slice(0, 6)` — the prototype's own cap, and the reason it is a
 * constant rather than a literal in the slice is that the section's meta has
 * to agree with it.
 */
const PHONE_ROWS = 6

/**
 * The em dash `money(null)` returns, which is what `OrdersRow.fees` carries
 * when the channel took nothing. The prototype tests the same value
 * (`o[6] === '&mdash;'`) for the same reason: "— fees" is not a sentence.
 *
 * `format.ts` does not export its own constant, so this is the one place the
 * character is repeated; a mismatch shows up immediately as "— fees" in the
 * island test rather than silently.
 */
const NO_FIGURE = "—"

/**
 * The two cells `mstrip([['Orders', …], ['Avg ticket', …]])` draws, picked out
 * of `buildOrdersStrip`'s five BY LABEL rather than by index.
 *
 * By label because the desk's order is the desk's business: if a cell is ever
 * inserted ahead of "Avg ticket" the phone should follow the name, not shift
 * one to the left and print marketplace fees under a heading that says
 * average ticket. A label the adapter stops producing drops the cell rather
 * than rendering a hole — and `.mstrip` is a two-track grid, so the layout
 * survives one cell as well as two.
 */
const PHONE_LABELS = ["Orders", "Avg ticket"] as const

function phoneCells(cells: StripCell[]): StripCell[] {
  return PHONE_LABELS.map((label) => cells.find((c) => c.label === label)).filter(
    (c): c is StripCell => c !== undefined,
  )
}

/** One strip cell's formatted value, by label, or null if the strip has none. */
function cellValue(cells: StripCell[] | null, label: string): string | null {
  const cell = cells?.find((c) => c.label === label)
  return typeof cell?.value === "string" ? cell.value : null
}

/**
 * One order as one `.mli`.
 *
 * `[o[0] + ' · ' + o[2], o[1] + ' · ' + o[4] + ' items', o[7], o[6] === '—' ?
 * 'no fees' : o[6] + ' fees']` — the prototype's own four slots, and only
 * four: it passes no fifth, so the qualifier under the figure is the bare
 * `em` and no row is painted up or down. That is right here. A fee is what
 * the channel charges, not a verdict on the order, and `.rt em.down` on every
 * marketplace row would mark nothing.
 *
 * One deliberate departure: the prototype writes `o[4] + ' items'`
 * unconditionally, which prints "1 items" on its own `#4815` fixture row. The
 * count is pluralised here instead, the way `orderCount` on the desk does it.
 *
 * The href is the PHONE's detail route. `OrdersRow.href` is
 * `/dashboard/orders/<id>`, which the middleware would rewrite for a phone
 * user agent — but a link is also what lands in the address bar and in
 * anything the reader shares, so the phone surface hands out phone paths. The
 * id is taken off the adapter's own href rather than re-derived, so the two
 * surfaces cannot disagree about which order a row means.
 */
function toListRow(r: OrdersRow): MListRow {
  return {
    key: r.key,
    title: `${r.id} · ${r.channel.label}`,
    detail: `${r.time} · ${r.items} item${r.items === "1" ? "" : "s"}`,
    // Already `ticket + commission`, already formatted. See the file note.
    value: r.net,
    // Three states, not two. "no fees" is a CLAIM and it is only true of an
    // in-house order; a marketplace row whose commission never synced shows
    // the same em dash and means something else entirely. See
    // `OrdersRow.feesRecorded`.
    note: !r.feesRecorded
      ? "fees not recorded"
      : r.fees === NO_FIGURE
        ? "no fees"
        : `${r.fees} fees`,
    href: phoneHref(r.href),
  }
}

const DESK_ORDER_PATH = "/dashboard/orders/"

function phoneHref(deskHref: string): string {
  return deskHref.startsWith(DESK_ORDER_PATH)
    ? `/m/orders/${deskHref.slice(DESK_ORDER_PATH.length)}`
    : deskHref
}
