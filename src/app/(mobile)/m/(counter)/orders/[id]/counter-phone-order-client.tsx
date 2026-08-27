"use client"

import {
  MList,
  MoneyLines,
  MStrip,
  Section,
  usePageChrome,
  type KvRow,
  type MListRow,
  type MoneyLine,
  type MathRow,
  type SwitchableStore,
} from "@/components/counter"
import { dataOf } from "@/lib/counter/section-data"
import type {
  OrderItemRow,
  OrderKeep,
  OrderSections,
  StripCell,
} from "@/lib/counter/adapters/orders"

/**
 * Counter — one order, on the phone. `P.order.phone()` at line 6617 of
 * `docs/counter/counter-prototype.html`, composed in its order and stopping
 * where it stops:
 *
 *   <div><h2 class="mtitle">…</h2><p class="msub">…</p></div>
 *   mstrip([['Ticket', …], ['You keep', …]])       TWO cells, not the desk's five
 *   sec('Items', 'N lines', mlist(…))
 *   sec('What you keep', '', money(…))
 *   <p class="mono">…the tax sentence…</p>          outside the section
 *
 * It calls the SAME adapter the desk calls (`getOrderSections`), so no figure
 * here can disagree with the same figure on `/dashboard/orders/<id>`: they are
 * the same rollup read through the same `SectionData`.
 *
 * ## The phone is a route, not a breakpoint
 *
 * `src/middleware.ts` rewrites `/dashboard/orders/<id>` to `/m/orders/<id>` on
 * a phone user agent, so THIS is what a phone renders and what
 * `npm run fidelity`'s `fidelity-mobile` project measures against
 * `P.order.phone()`. A screenshot of the desk route at 390px photographs the
 * desk squeezed and says nothing about this file.
 *
 * ## `MoneyLines`, not `MathLines`, because the prototype says so
 *
 * The desk draws the chain as ARITHMETIC — `.mathline`, with `Net to you`
 * ruled off in the middle of it — and the phone draws it as a STATEMENT:
 * `money()` at line 6626, four rows, no `Net to you`, a heavier last line for
 * the contribution. They are different marks in the prototype's own vocabulary
 * (see `MoneyLines`' doc comment on why it is not `Kv` either), and this
 * surface takes the one the design gives it rather than the one the desk
 * already had.
 *
 * ## What the phone drops, and it is the prototype that drops it
 *
 * | Desk | Phone |
 * |---|---|
 * | `.strip`, five cells | `.mstrip`, two cells |
 * | the six-column `.tbl` with its bold total row | `.mlist` |
 * | `sec('Timeline', …, kv(…))` | — |
 * | `sec('Platform', …, kv(…))` | — |
 * | `sec('Needs you', …, queue(…))` | — |
 *
 * The last three are worth naming, because all three arrive on `sections` and
 * it would be three lines to draw them. They are not drawn: an extra landmark
 * is never forgiven (ruling F-R8), and the phone's job on this page is the one
 * question a phone reader has in the middle of service — what did this order
 * leave behind.
 *
 * ## No arithmetic on `discount` or `commission`, anywhere on this page
 *
 * Both columns are stored as signed deductions (`src/lib/counter/order-signs.ts`)
 * and the adapter has already applied them. **This is the defect this file
 * exists to end.** The editorial page it replaces printed its `FEES + TAX`
 * masthead cell as `fmtMoney(order.tax + order.commission)` — with a NEGATIVE
 * commission column, that subtracts the marketplace's cut from the tax and
 * prints a figure smaller than the tax alone, usually negative on a DoorDash
 * order. Every figure below is printed, never computed.
 */
export function CounterPhoneOrderClient({
  stores,
  sections,
}: {
  stores: SwitchableStore[]
  sections: OrderSections
}) {
  const head = dataOf(sections.head)
  const platform = dataOf(sections.platform)
  const storeName = rowValue(platform, "Store")
  const note = dataOf(sections.keep)?.note

  /*
   * The one chrome fact this page has that its URL does not: the store it
   * belongs to, read off the Platform section BY LABEL so `.mtop`'s `.st`
   * cannot name a different store than the section below it does.
   *
   * The three things the shell used to be told and now works out for itself:
   * `.mback` (`phoneTrail`), the ABSENCE of a date chip (`hasWindow` — `P.order`
   * is `nodate: true` at line 6569, and one order does not have a range), and
   * where a store PICK goes (`storeScopeHref` — a record route sends the
   * reader to that store's list). All three come off the route string in
   * `src/lib/counter/route-shape.ts`, so they are right on the first paint.
   */
  usePageChrome({
    storeName,
    storeId: stores.find((s) => s.name === storeName)?.id ?? null,
  })

  return (
    /*
     * A FRAGMENT. `.ct-root.ct-phone`, `.mtop` and `.mscroll` are
     * `src/app/(mobile)/m/(counter)/layout.tsx`'s now — see
     * `counter-phone-overview-client.tsx` for the long version.
     */
    <>
      {/* `buildOrderHead`'s own two strings. The prototype's phone sub is
          shorter than its desk sub ('DoorDash · 9:32pm' against 'DoorDash ·
          Aug 21, 9:32pm · 3 items'); the adapter writes one sentence and both
          surfaces print it, because a second shortened form would be a second
          place for the stamp to be wrong. */}
      <div>
        <h2 className="mtitle">{head?.title ?? "Order"}</h2>
        {head?.sub ? <p className="msub">{head.sub}</p> : null}
      </div>

      {/* Two cells, chosen by NAME out of the adapter's five. Nothing here is
          judged — ruling O-R2 — so no cell carries a reference and the phone
          draws no bullet and no band. */}
      <Section bare title="The figures" data={sections.strip}>
        {(cells) => <MStrip cells={phoneCells(cells)} />}
      </Section>

      <Section title="Items" meta={dataOf(sections.items)?.meta} data={sections.items}>
        {(items) => <MList rows={items.rows.map(toListRow)} />}
      </Section>

      {/* `sec('What you keep', '', money(…))` — no meta in the prototype, and
          none here. */}
      <Section title="What you keep" data={sections.keep}>
        {(keep) => <MoneyLines rows={moneyRows(keep)} />}
      </Section>

      {/* OUTSIDE the section, exactly as the prototype writes it, and with
          its own inline type scale. The tax figure lives here and nowhere
          else on the page: it was never the restaurant's money, so stating it
          inside the statement would invite subtracting it twice. */}
      {note ? (
        <p
          className="mono"
          style={{ margin: "8px 0 0", fontSize: "11px", color: "var(--ink-3)" }}
        >
          {note}
        </p>
      ) : null}
    </>
  )
}

/**
 * The two cells `mstrip([['Ticket', …], ['You keep', …]])` draws, picked out of
 * `buildOrderStrip`'s five BY LABEL rather than by index.
 *
 * By label because the desk's order is the desk's business: if a cell is ever
 * inserted ahead of "You keep" the phone should follow the name, not shift one
 * to the left and print marketplace fees under a heading that says what you
 * keep. A label the adapter stops producing drops the cell rather than
 * rendering a hole — and `.mstrip` is a two-track grid, so the layout survives
 * one cell as well as two.
 */
const PHONE_LABELS = ["Ticket", "You keep"] as const

function phoneCells(cells: StripCell[]): StripCell[] {
  return PHONE_LABELS.map((label) => cells.find((c) => c.label === label)).filter(
    (c): c is StripCell => c !== undefined,
  )
}

/**
 * The desk's math chain, restated as the phone's money statement.
 *
 * Two differences from `MathLines`, and both are the prototype's:
 *
 *  1. **`Net to you` is not drawn.** `money()` at line 6626 goes Ticket →
 *     Commission → Food cost → Contribution. The intermediate subtotal is what
 *     a `.mathline` chain is FOR; a statement states what came in, what went
 *     out and what is left.
 *  2. **The labels drop the operator.** A `.mathline` label reads `− food cost`
 *     because the row IS the subtraction; a `.moneyline` puts the sign on the
 *     figure, so a label carrying one too would print the minus twice.
 *
 * Keyed on `MathRow.key` — the adapter's own stable names — rather than on the
 * label text, so this does no string surgery and a row it does not name still
 * appears, under the label the adapter gave it, instead of vanishing.
 */
const PHONE_KEEP_LABELS: Record<string, string> = {
  ticket: "Ticket",
  commission: "Commission",
  food: "Food cost",
  contribution: "Contribution",
}

/** The one row the phone drops. See above. */
const PHONE_KEEP_SKIP = "net"

function moneyRows(keep: OrderKeep): MoneyLine[] {
  return keep.rows
    .filter((r: MathRow) => r.key !== PHONE_KEEP_SKIP)
    .map((r: MathRow) => ({
      label: PHONE_KEEP_LABELS[r.key] ?? r.label,
      value: r.value,
      // `'bad'` on the commission row alone — line 6627. It is the one figure
      // on this list that left the building.
      tone: r.key === "commission" ? ("bad" as const) : undefined,
      // `.moneyline.total`, the heavier last line. A SHAPE, not a colour.
      total: r.key === "contribution",
    }))
}

/**
 * The em dash the adapter prints when there is no margin to state — a free
 * modifier keeps $0.00, so its margin is `0/0` and `marginFigure` guards it.
 *
 * "— margin" is not a sentence, which is the same reading the orders list
 * makes of "— fees". The qualifier is dropped instead: a giveaway line has a
 * price and no margin, and saying nothing is the honest version of that.
 * `format.ts` exports no constant for the character, so this is the one place
 * it is repeated, and a mismatch shows up in the island test rather than
 * silently.
 */
const NO_FIGURE = "—"

/**
 * One line as one `.mli`.
 *
 * `[l.name, l.mod ? 'modifier · no recipe' : '1', USD2(l.price),
 *   l.cost == null ? 'not costed' : N + '% margin', l.cost == null ? 'down' : 'up']`
 * — line 6622, with one honesty repair. The prototype writes
 * `'modifier · no recipe'` on EVERY modifier, which is true of its one fixture
 * modifier and false in general; here the "no recipe" half is said only when
 * the line actually has none.
 *
 * No href. The prototype opens a menu-item page from every non-modifier row
 * (`mlist(…, 'catalogitem')`); `OrderItemRow` carries no destination, and
 * `.mli.is-link` is set from `href` alone precisely so a row cannot advertise
 * a tap that does nothing — the ported sheet's own comment above that rule.
 */
function toListRow(l: OrderItemRow): MListRow {
  const margin = l.uncosted ? "not costed" : l.margin === NO_FIGURE ? null : `${l.margin} margin`

  return {
    key: l.key,
    title: l.name,
    detail: l.modifier ? (l.uncosted ? "modifier · no recipe" : "modifier") : l.qty,
    // What the channel charged for this line. Already formatted.
    value: l.price,
    ...(margin === null
      ? {}
      : { note: margin, noteTone: l.uncosted ? ("down" as const) : ("up" as const) }),
  }
}

/**
 * One `KvRow`'s value, by label, or null. The same accessor the desk island
 * uses, and for the same reason — a row inserted into `buildOrderPlatform`
 * must not shift another one into this slot.
 */
function rowValue(rows: KvRow[] | null, label: string): string | null {
  const value = rows?.find((r) => r.label === label)?.value
  return typeof value === "string" ? value : null
}
