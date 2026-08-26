"use client"

import { useState, type KeyboardEvent, type ReactNode } from "react"
import { Caret } from "./caret"
import { Spark } from "./spark"
import { money, count } from "@/lib/counter/format"
import { shortDate } from "@/lib/counter/date-range"

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
 * absence of one, drawn with the authority of a figure. A card can hold what
 * that store DOES have, which is the only news those two stores carry.
 *
 * "Build-out at 68% and 31%" is the one part of that sentence this codebase
 * cannot honour: no column, no milestone table, nothing. See `PreOpenStore`
 * below for what replaced it and why.
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
 * What the pre-open arm carries instead is the half of `prePanel()` the schema
 * can actually answer: when the store opens, and what its store file is still
 * missing — "rent is still missing", which is why its P&L could not be right on
 * day one even after it opens.
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
  /**
   * `trading` is `Store.lifecycleStage === "ready"`; `warming_up` is a store
   * that has opened and whose figures are still settling. Both are
   * OPERATIONAL (`isOperational` is `stage !== "pre_open"`), so both get a
   * trading card — the tag is the difference, and it carries the model's own
   * vocabulary rather than a second one invented here.
   */
  stage: "trading" | "warming_up"
  /** Net sales over the range. A trading store HAS this figure. */
  netSales: number
  /** The shape behind the figure. `Spark` renders nothing under two points. */
  series: number[]
  /** Pre-formatted: "▲ 4.1% vs the prior period", or "no comparison set". */
  comparison: string
  orders: number
  /**
   * `null` when the store took no orders in the range — never `0`, which
   * claims every order was free. An em-dash HERE is one missing measurement on
   * a card that carries every other figure, which is a different thing from
   * note 33's table, where the em-dash WAS the row.
   */
  ticket: number | null
  /** `null` when no labour hours were posted for the range. Same rule as `ticket`. */
  salesPerHour: number | null
  /** What opens underneath — the channel breakdown for this store. */
  panel: ReactNode
}

/**
 * A store that has not opened.
 *
 * ## What this arm used to ask for, and why it no longer does
 *
 * It required `buildOutPct: number` and `blocker: string` — the prototype's
 * "Build-out 68% · hood and fire suppression signed off". Phase C went looking
 * for both and found **no build-out column, no milestone table and nothing
 * resembling one** anywhere in `prisma/schema.prisma`. The prototype's 68% and
 * 31% are invented for the mockup, exactly like its `$25.10–$26.40` ticket
 * band and its `SPLH_FLOOR = 68.00`.
 *
 * Synthesising a percentage to fill the meter would be note 33's em-dash table
 * reached by another route: a figure drawn with the authority of a measurement
 * nobody took. So this arm carries what the store file actually has — when it
 * is expected to open, and which of its fields are still blank — and the card
 * draws THOSE. "Rent is still missing" is the prototype's own second sentence,
 * and unlike its percentage it is both true and actionable.
 */
export interface PreOpenStore {
  kind: "pre_open"
  id: string
  name: string
  /** `Store.openedAt`. `null` when nobody has set a date — not a guess at one. */
  opensOn: Date | null
  /** Which fields of its store file are still blank: `["Rent", "Opening date"]`. */
  missingFromFile: string[]
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

/**
 * The three words a Counter surface calls a store's stage, in ONE place.
 *
 * The desk prints them inside a `.mtag` chip and the phone prints them as the
 * `.prow em` under the store's name (`StoreRows`) — two renderings, one
 * vocabulary. Two labels each written at its own call site is how the
 * `trading | fit_out | pre_open` / `trading | warming_up | pre_open` split
 * happened, which `CARD_STAGE_FOR` in the Overview adapter had to unpick.
 */
export function stageLabel(store: StoreCard): string {
  if (store.kind === "pre_open") return "Pre-open"
  // "Warming up" rather than the prototype's own "Fit-out 68%", because
  // warming-up is a stage the model actually publishes and 68% is not a figure
  // anything measures.
  return store.stage === "warming_up" ? "Warming up" : "Trading"
}

function Tag({ store }: { store: StoreCard }) {
  if (store.kind === "pre_open") return <span className="mtag">{stageLabel(store)}</span>
  // `.mtag warn` is the prototype's louder tag.
  if (store.stage === "warming_up") return <span className="mtag warn">{stageLabel(store)}</span>
  return <span className="mtag good">{stageLabel(store)}</span>
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

/**
 * The prototype's build-out meter is not here, and its absence is the point —
 * see `PreOpenStore`. What a pre-open store's file DOES answer is when it opens
 * and what is still blank in it, so those are the two things the card says.
 */
function PreOpenBody({ store }: { store: PreOpenStore }) {
  const missing = store.missingFromFile
  return (
    <>
      <span className="k">Opens</span>
      <span className="v">{store.opensOn ? shortDate(store.opensOn) : "No date set"}</span>
      <span className="d">No sales, no labour and no invoices yet</span>
      <p className="stnote">
        {missing.length === 0 ? (
          <>Its store file is complete, so its P&amp;L is ready the day it opens.</>
        ) : (
          <>
            <b>
              {listOf(missing)} {missing.length === 1 ? "is" : "are"} still missing
            </b>{" "}
            from its store file, so its P&amp;L cannot be right the day it opens.
          </>
        )}
      </p>
    </>
  )
}

/** `["Rent", "Opening date"]` -> `"Rent and Opening date"`. */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

/** Stable and unique per store, so `aria-controls` names a real element. */
function panelId(id: string): string {
  return `stcard-panel-${id}`
}
