"use client"

import { type ReactNode } from "react"
import {
  Kv,
  MathLines,
  PageHead,
  Queue,
  Section,
  Strip,
  Table,
  usePageChrome,
  type Column,
  type KvRow,
  type Row,
  type SwitchableStore,
} from "@/components/counter"
import { dataOf } from "@/lib/counter/section-data"
import type {
  OrderItemRow,
  OrderItems,
  OrderReconcileRow,
  OrderSections,
} from "@/lib/counter/adapters/orders"

/**
 * Counter — one order, on the desk. Composed from `P.order.desk()`
 * (`docs/counter/counter-prototype.html:6572`) in the prototype's own order:
 *
 *   strip([...five cells])                          page level, above any .sec
 *   <div class="split">sec('Items') sec('What you keep')</div>
 *   <div class="tri">sec('Timeline') sec('Platform') sec('Needs you')</div>
 *
 * `.split` and `.tri` are BARE wrapper divs the ported sheet already styles
 * (counter-components.css) — they are written inline here exactly as
 * `counter-overview-client.tsx` writes them, because there is nothing for a
 * component to add to a `<div class="split">`.
 *
 * A page composes primitives and reads exactly one adapter's output; it never
 * imports Prisma or an action directly and never inspects `SectionData.status`
 * — `npm run tokens` fails the build on either. `Section` is the sole state
 * renderer, `bare` for the strip, which is not a `.sec`.
 *
 * ## The date control is not here, and it is not hidden either
 *
 * `P.order` is declared `nodate: true` (line 6569) and `deskFor()` writes
 * `(src.nodate ? '' : CD.bar())`. ONE ORDER DOES NOT HAVE A RANGE, so there is
 * nothing for a window to widen and nothing for a comparison to compare
 * against. `AppShell` already has the mechanism: `actions` is optional and
 * `PageHead` emits `.phactions` only when there is something to put in it, so
 * omitting the prop removes the control rather than hiding a live one. No new
 * prop was needed and none was added — a `nodate` boolean would have been a
 * second way to say what not passing `actions` already says.
 *
 * `presetId` / `onSelectPreset` are omitted for the same reason: they are what
 * make `AskSurface` draw its "Change the range" group, and a palette row that
 * changes nothing is note 46's exact defect.
 *
 * ## Every figure on this page is printed, never computed
 *
 * `OtterOrder.discount` and `OtterOrder.commission` are stored as SIGNED
 * DEDUCTIONS (`src/lib/counter/order-signs.ts`). The adapter has already
 * applied them — the strip's fee, the table's `keep` column, the money chain —
 * so nothing below does arithmetic on money. The page this route replaces did:
 * `/m/orders/[id]` printed its `FEES + TAX` cell as `tax + commission` and,
 * with a negative commission column, showed a figure SMALLER than the tax
 * alone. That is what a composition doing its own sums buys.
 *
 * ## What the prototype has here and this page does not
 *
 * - **A link out of every item row.** `tbl(…, 'catalogitem')` opens a menu-item
 *   page from each non-modifier row. `OrderItemRow` carries no href, and a row
 *   that wears the cursor, the hover wash, the focus rail and the chevron and
 *   then goes nowhere is note 46's defect. When the catalogue page is rebuilt
 *   and the adapter carries a destination, the rows become links in one edit.
 * - **A `.do` button on the "Needs you" item.** `buildNeedsYou` deliberately
 *   wires no `act` and says the page should attach one. The page cannot: an
 *   unmapped ITEM is mapped on `/dashboard/menu/catalog` and an unmapped
 *   MODIFIER on `/dashboard/ingredients`, and `QueueItem` carries nothing that
 *   says which of the two this is. One button would send half the readers to
 *   the wrong page, which is worse than no button.
 * - **An "Ask about this" button on any section.** `sec()`'s fourth argument is
 *   what emits `.askmini`, and `P.order.desk()` passes it on none of its five.
 *   The ⌘K surface still carries this page's own suggestions.
 */
/** The ⌘K palette's "Ask about this order" group. Module-level, so the shell
 *  is not republished on every render of this page. */
const ASK_SUGGESTIONS = [
  "What did this order actually leave behind?",
  "Which line on this order is not costed?",
  "How much did the marketplace take on this one?",
]

export function CounterOrderClient({
  stores,
  sections,
}: {
  stores: SwitchableStore[]
  sections: OrderSections
}) {
  const head = dataOf(sections.head)
  const platform = dataOf(sections.platform)
  const channel = rowValue(platform, "Channel")
  const storeName = rowValue(platform, "Store")

  /*
   * THE ONLY CHROME THIS PAGE STILL PUBLISHES, and the reason `PageChrome`
   * exists at all: none of the three can be read off the URL.
   *
   *   - the trail names the RECORD at its leaf ("Hollywood / Orders / Order
   *     #4821"), which is `Topbar`'s own documented contract for a detail
   *     route, and the record's name comes out of an adapter;
   *   - the store is read off the Platform section BY LABEL, so the rail
   *     cannot name a different store than the section below it does;
   *   - the palette's questions are this page's own.
   *
   * Where a store PICK goes is not here: `route-shape.ts` knows that a record
   * route sends the reader to that store's list, because selecting a store
   * cannot re-scope a page about one order and `?store=` on this URL would
   * mean nothing.
   */
  usePageChrome({
    leaf: head?.title,
    storeName,
    storeId: stores.find((s) => s.name === storeName)?.id ?? null,
    askSuggestions: ASK_SUGGESTIONS,
  })

  return (
    <>
      <PageHead
        // The record, not the route: `Order #4821`, with the channel, the stamp
        // and the line count underneath it — `buildOrderHead`'s own two strings.
        // A head that has not loaded leaves the masthead with a name and no
        // sentence rather than an empty line where a sentence goes.
        title={head?.title ?? "Order"}
        sub={head?.sub}
      />

      {/* Page level, above the first `.sec`, exactly as `strip([...])` is
          written in `P.order.desk()`. Ruling O-R2: no cell here is judged
          against anything, because nothing in this schema publishes a
          per-order target, a fee ceiling or a ticket floor. */}
      <Section bare title="The figures" data={sections.strip}>
        {(cells) => <Strip cells={cells} />}
      </Section>

      <div className="split">
        <Section
          title="Items"
          // The adapter's own sentence: "2 lines · 1 modifier", or the reason
          // there are none — "line detail not drained yet" is a different fact
          // from "no lines on this order" and only the loader knows which.
          meta={dataOf(sections.items)?.meta}
          // `tbl()` is `raw()` in the prototype: a Table fills the section edge
          // to edge and brings its own padding.
          pad={false}
          data={sections.items}
        >
          {(items) => <ItemsTable items={items} channel={channel} />}
        </Section>

        <Section title="What you keep" meta="the whole chain" data={sections.keep}>
          {(keep) => (
            <>
              {/* Every row IS summed into the figure below it. That is why the
                  tax figure is in the paragraph and not in this list — see
                  `MathLines`' own doc comment, and prototype line 6600. */}
              <MathLines rows={keep.rows} />
              {keep.note ? (
                // The prototype's own inline margin on this paragraph.
                <p className="mono" style={{ margin: "10px 0 0" }}>
                  {keep.note}
                </p>
              ) : null}
            </>
          )}
        </Section>
      </div>

      <div className="tri">
        <Section title="Timeline" meta="from the POS" data={sections.timeline}>
          {(rows) => <Kv rows={rows} />}
        </Section>

        {/* `sec('Platform', 'DoorDash', …)` — the meta is the channel, which is
            the section's own first row. Read by label so an inserted row
            cannot make it print a fulfilment mode instead. */}
        <Section title="Platform" meta={channel ?? undefined} data={sections.platform}>
          {(rows) => <Kv rows={rows} />}
        </Section>

        {/* `sec('Needs you', '1', queue(…))` — the meta is how many. An order
            with nothing to fix arrives here as an EMPTY section, which is what
            the adapter means by it and what `Section` draws. */}
        <Section
          title="Needs you"
          meta={countMeta(dataOf(sections.needsYou)?.length)}
          data={sections.needsYou}
        >
          {(items) => <Queue items={items} />}
        </Section>
      </div>
    </>
  )
}

/**
 * One `KvRow`'s value, by label, or null.
 *
 * By LABEL rather than by index, the same discipline the phone orders list
 * uses on the strip: if `buildOrderPlatform` ever inserts a row, the page that
 * wanted the channel gets the channel rather than whatever moved into slot 0.
 * `KvRow.value` is a `ReactNode` because a row may carry a mark; only a plain
 * string can be used as a heading or an id, so anything else reads as absent.
 */
function rowValue(rows: KvRow[] | null, label: string): string | null {
  const value = rows?.find((r) => r.label === label)?.value
  return typeof value === "string" ? value : null
}

/** `sec('Needs you', '1', …)` — the count, or no meta at all. */
function countMeta(n: number | undefined): string | undefined {
  return n === undefined ? undefined : String(n)
}

/**
 * The lines, and the total row that is the sum of them.
 *
 * `[{t:'Item'},{t:'Qty',n:1},{t:'DoorDash price',n:1},{t:'After commission',n:1},
 *   {t:'Food cost',n:1},{t:'Margin',n:1}]` — prototype line 6581. The third
 * column is named after the channel that set the price, which is a fact about
 * this order and not about the table; it comes off the Platform section rather
 * than being re-derived, and falls back to "Ticket price" if that section did
 * not load.
 */
function ItemsTable({ items, channel }: { items: OrderItems; channel: string | null }) {
  const columns: Column[] = [
    { key: "item", label: "Item" },
    { key: "qty", label: "Qty", numeric: true },
    { key: "price", label: `${channel ?? "Ticket"} price`, numeric: true },
    { key: "keep", label: "After commission", numeric: true },
    { key: "cost", label: "Food cost", numeric: true },
    { key: "margin", label: "Margin", numeric: true },
  ]

  return (
    <Table
      columns={columns}
      rows={[
        ...items.rows.map(lineRow),
        totalRow(items.total),
        // The chain from that total to the order's own ticket, when the drained
        // lines do not reach it. Empty on 88% of orders, and never a row the
        // adapter did not compute — see `buildOrderItems`.
        ...items.reconcile.map(reconcileRow),
      ]}
    />
  )
}

/**
 * `'&nbsp;&nbsp;&mdash; ' + l.name` for a modifier, `'<b>' + l.name + '</b>'`
 * for an item — prototype line 6584. The indent is the prototype's own two
 * non-breaking spaces, kept because that is what the design draws; a padded
 * cell would be a rule the ported sheet does not have.
 */
function lineRow(l: OrderItemRow): Row {
  return {
    key: l.key,
    cells: {
      item: l.modifier ? <>{"  — "}{l.name}</> : <b>{l.name}</b>,
      qty: l.qty,
      price: l.price,
      keep: l.keep,
      cost: l.uncosted ? <NotCosted>{l.cost}</NotCosted> : l.cost,
      // Already an em dash when this line keeps nothing — `marginFigure` guards
      // the divide, and the page prints what it said rather than dividing again.
      margin: l.margin,
    },
  }
}

/** Every cell bold — `{ v: '<b>' + … + '</b>' }` on all six, line 6588. */
function totalRow(t: OrderItemRow): Row {
  return {
    key: t.key,
    cells: {
      item: <b>{t.name}</b>,
      qty: <b>{t.qty}</b>,
      price: <b>{t.price}</b>,
      keep: <b>{t.keep}</b>,
      cost: <b>{t.cost}</b>,
      margin: <b>{t.margin}</b>,
    },
  }
}

/**
 * One row of the reconciliation chain under the Total.
 *
 * Only the two money columns are filled. Qty, food cost and margin are left
 * absent rather than dashed: a quantity for "not on any line here" would be a
 * figure this page does not have, and an em dash in a numeric column reads as
 * one that was looked for. `Cell`s are keyed by column, so an omitted key
 * renders an empty cell and cannot shift the row.
 */
function reconcileRow(r: OrderReconcileRow): Row {
  const strong = (v: string) => (r.strong ? <b>{v}</b> : v)
  return {
    key: r.key,
    cells: {
      item: strong(r.label),
      price: strong(r.price),
      keep: strong(r.keep),
    },
  }
}

/**
 * `<span style="color:var(--bad)">not costed</span>` — prototype line 6587.
 *
 * It is a WARNING sitting in a money column, and the colour is what stops a
 * reader taking it for a figure. The inline style names a token rather than a
 * value (`--bad` is `counter-components.css`'s alias of `--ct-bad`), which is
 * the same thing `toneStyle` does for `Kv` and `Queue` and the same reason
 * `npm run tokens`' no-colour-literal rule does not fire on it: it matches
 * `#hex`, `oklch(`, `rgb(` and `hsl(`, and a `var()` is none of those.
 */
function NotCosted({ children }: { children: ReactNode }) {
  return <span style={{ color: "var(--bad)" }}>{children}</span>
}
