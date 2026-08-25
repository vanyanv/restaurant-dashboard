"use client"

import { useState, type KeyboardEvent, type ReactNode } from "react"
import { Caret } from "./caret"
import { Spark } from "./spark"
import { money, count } from "@/lib/counter/format"

/**
 * The stores, as small multiples. **This is note 33, and it is the element the
 * whole fidelity effort was diagnosed on.**
 *
 * > "three of the rows were em-dashes … the ledger printed twelve em-dashes and
 * > called it a store list. They are cards now, and the two that are not
 * > trading show the figure they do have — build-out at 68% and 31%."
 *
 * The shipped app renders a four-column table — store, net sales, COGS %, vs
 * target — and Glendale and Van Nuys have none of those four, because they have
 * no customers. A table demands that every row answer the same columns, so the
 * two that cannot answer print `$0`, `0.0%` and an em-dash: not an answer, the
 * absence of one, drawn with the authority of a figure. A card can hold a
 * build-out meter and the thing blocking it, which is the only news those two
 * stores have.
 *
 * Ported from `stores()` at line 3903 of `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="stores">
 *   <div class="stcard" role="button" tabindex="0" aria-expanded="false">
 *     <div class="stcard__h"><span class="car">…</span><b>Hollywood</b>
 *          <span class="mtag good">Trading</span></div>
 *     <span class="k">Net sales</span><span class="v">$25,879</span>
 *     <svg class="sp">…</svg>
 *     <span class="d">▲ 4.1% vs the prior period</span>
 *     <dl class="stfig"><div><dt>Orders</dt><dd>1,024</dd></div>…</dl>
 *   </div>
 *   …two more cards…
 *   <div class="ldrawer is-open"><div class="lpanel">…</div></div>  ×3
 *   <div class="stores__foot"><span>…</span><span>…</span></div>
 * </div>
 * ```
 *
 * ## The type is the enforcement
 *
 * `StoreCard` is a discriminated union and the two arms have **no field in
 * common beyond identity**. A trading card carries `netSales: number` — not
 * `number | null`, so there is no null to render as a dash. A pre-open card has
 * no `netSales` field at all, so there is nothing to pass one to. The rule
 * "a card never prints an em-dash for a figure that does not apply to it" is
 * therefore not a review note; it is a type error.
 *
 * What the pre-open arm carries instead is what Task 6 found in `headBlock()`'s
 * empty branch and `prePanel()`: the build-out percent it does have, what that
 * percent is waiting on, and what its store file is still missing — "rent is
 * still missing", which is why its P&L could not be right on day one even after
 * it opens.
 *
 * ## Card order, drawer order
 *
 * All cards, then all drawers. `.stores` is a three-column grid and
 * `.stores > .ldrawer` is `grid-column: 1 / -1` (counter-components.css:1124),
 * so a drawer only lands under the row of cards if it comes after every one of
 * them in source order. Interleaving them would put Hollywood's panel between
 * Hollywood and Glendale.
 *
 * ## One open at a time
 *
 * The prototype's delegated handler closes every sibling before opening a card
 * (prototype line 9058): "Cards sit side by side and their drawers stack
 * underneath, so two open at once reads as one panel belonging to the wrong
 * card." That rule is shared across three cards, which is why this component
 * owns the state and `Drill` does not.
 *
 * ## What this adds to the prototype
 *
 * `aria-controls` on each card, pointing at the panel it opens — see `Drill`
 * for the same addition and the same reason. The prototype's `role="button"` +
 * `tabIndex={0}` + Enter/Space handling is kept verbatim: `.stcard` is a `div`
 * because `.stcard[aria-expanded="true"]` and `.stcard__h .mtag` are written
 * against one, and a `<button>` cannot legally contain the `<dl>` inside it.
 */
export interface TradingStore {
  kind: "trading"
  id: string
  name: string
  /** Net sales over the range. A trading store HAS this figure. */
  netSales: number
  /** The shape behind the figure. `Spark` renders nothing under two points. */
  series: number[]
  /** Pre-formatted: "▲ 4.1% vs the prior period", or "no comparison set". */
  comparison: string
  orders: number
  ticket: number
  salesPerHour: number
  /** What opens underneath — the channel breakdown for this store. */
  panel: ReactNode
}

export interface PreOpenStore {
  kind: "pre_open"
  id: string
  name: string
  /**
   * Both are the model's `pre_open` lifecycle stage; these are the prototype's
   * own two tag words for how far along the build is. `fit_out` is the louder
   * of the two (`.mtag warn`) because a store with a signed-off milestone is
   * the one with a date attached to it.
   */
  stage: "fit_out" | "pre_open"
  /** 0–100. The figure this store DOES have. */
  buildOutPct: number
  /** What the percent is waiting on: "Hood and fire suppression signed off". */
  blocker: string
  /** What its store file is still missing: "Rent". */
  missingFromFile: string
  panel: ReactNode
}

export type StoreCard = TradingStore | PreOpenStore

export function StoreCards({
  stores,
  notes,
  defaultOpenId,
}: {
  stores: StoreCard[]
  /** `.stores__foot` — the prototype writes two, in a two-column grid. */
  notes?: ReactNode[]
  defaultOpenId?: string
}) {
  const [openId, setOpenId] = useState<string | null>(defaultOpenId ?? null)

  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id))
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      // Space scrolls the page on a div; Enter does nothing. Both must act
      // like the button this element is standing in for.
      e.preventDefault()
      toggle(id)
    }
  }

  return (
    <div className="stores">
      {stores.map((s) => (
        <div
          key={s.id}
          className="stcard"
          role="button"
          tabIndex={0}
          aria-expanded={openId === s.id}
          aria-controls={panelId(s.id)}
          onClick={() => toggle(s.id)}
          onKeyDown={(e) => onKeyDown(e, s.id)}
        >
          <div className="stcard__h">
            <Caret />
            <b>{s.name}</b>
            <Tag store={s} />
          </div>
          {s.kind === "trading" ? <TradingBody store={s} /> : <PreOpenBody store={s} />}
        </div>
      ))}

      {stores.map((s) => (
        <div
          key={s.id}
          className={openId === s.id ? "ldrawer is-open" : "ldrawer"}
          id={panelId(s.id)}
        >
          <div className="lpanel">{s.panel}</div>
        </div>
      ))}

      {notes && notes.length > 0 ? (
        <div className="stores__foot">
          {notes.map((n, i) => (
            <span key={i}>{n}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Tag({ store }: { store: StoreCard }) {
  if (store.kind === "trading") return <span className="mtag good">Trading</span>
  if (store.stage === "fit_out")
    return <span className="mtag warn">Fit-out {pctLabel(store.buildOutPct)}</span>
  return <span className="mtag">Pre-open</span>
}

function TradingBody({ store }: { store: TradingStore }) {
  return (
    <>
      <span className="k">Net sales</span>
      <span className="v">{money(store.netSales)}</span>
      <Spark series={store.series} />
      <span className="d">{store.comparison}</span>
      <dl className="stfig">
        <div>
          <dt>Orders</dt>
          <dd>{count(store.orders)}</dd>
        </div>
        <div>
          <dt>Ticket</dt>
          <dd>{money(store.ticket, { cents: true })}</dd>
        </div>
        <div>
          <dt>Sales/hr</dt>
          <dd>{money(store.salesPerHour, { cents: true })}</dd>
        </div>
      </dl>
    </>
  )
}

function PreOpenBody({ store }: { store: PreOpenStore }) {
  const w = Math.min(100, Math.max(0, store.buildOutPct))
  return (
    <>
      <span className="k">Build-out</span>
      <span className="v">{pctLabel(store.buildOutPct)}</span>
      <span className="bld">
        <i style={{ width: `${w}%` }} />
      </span>
      <span className="d">{store.blocker}</span>
      <p className="stnote">
        <b>{store.missingFromFile} is still missing</b> from its store file.
      </p>
    </>
  )
}

function pctLabel(v: number): string {
  return `${Math.round(v)}%`
}

/** Stable and unique per store, so `aria-controls` names a real element. */
function panelId(id: string): string {
  return `stcard-panel-${id}`
}
