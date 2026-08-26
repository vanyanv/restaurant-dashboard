"use client"

import { useState } from "react"
import { Caret } from "./caret"
import { stageLabel, type StoreCard } from "./store-cards"
import { money, count } from "@/lib/counter/format"
import { shortDate } from "@/lib/counter/date-range"

/**
 * The stores, as the phone lists them: one disclosure row each, with the same
 * channel panel the desk's cards open.
 *
 * Ported from `pstores()` at line 3868 of `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="pstore">
 *   <button class="prow" type="button" aria-expanded="false">
 *     <span class="car">…chevron…</span>
 *     <span class="pn"><b>Hollywood</b><em>Trading</em></span>
 *     <span class="pv">$25,879<em>1,024 orders</em></span>
 *   </button>
 *   <div class="ldrawer"><div class="lpanel">…chanPanel()…</div></div>
 * </div>
 * …two more…
 * ```
 *
 * ## Why the phone does not reuse `StoreCards`
 *
 * `.stores` is a three-column grid and `.stcard` carries a sparkline, a
 * comparison sentence and a three-figure `<dl>`. None of that fits 316px of
 * content width, which is why the prototype writes a second function rather
 * than reflowing the first. **The panel is the same on both surfaces** — the
 * desk and the phone both open `chanPanel()`, and here that means the caller
 * passes the same `ChannelRows` element it passes to `StoreCards`. That is the
 * rule about one figure coming from one function, applied to markup: the
 * channel breakdown is built once, in the page, and mounted by whichever
 * surface is rendering.
 *
 * `.pstore .chan__row` is re-gridded by the sheet itself
 * (counter-components.css:1019) to the narrower three-column form, so nothing
 * about the panel changes here.
 *
 * ## What a pre-open row shows, and what it does not
 *
 * The prototype's row reads `68%` over `build-out`. There is no build-out
 * column, no milestone table and nothing resembling one — ruling C-R3, the
 * same finding `PreOpenStore` records at length. This row shows the store's
 * opening date over the word `opens`, which its file actually answers, and
 * says the rest in the panel underneath.
 *
 * ## One open at a time
 *
 * The prototype's delegated handler closes every sibling before opening a row.
 * On the desk that rule exists because drawers stack under a grid of cards; on
 * the phone it exists because three open panels is a page nobody can find
 * anything in. Either way the state belongs to the list, not to a row.
 */
export function StoreRows({
  stores,
  defaultOpenId,
}: {
  stores: StoreCard[]
  defaultOpenId?: string
}) {
  const [openId, setOpenId] = useState<string | null>(defaultOpenId ?? null)

  return (
    <div>
      {stores.map((s) => {
        const open = openId === s.id
        return (
          <div className="pstore" key={s.id}>
            <button
              className="prow"
              type="button"
              aria-expanded={open}
              aria-controls={panelId(s.id)}
              onClick={() => setOpenId(open ? null : s.id)}
            >
              <Caret />
              <span className="pn">
                <b>{s.name}</b>
                <em>{stageLabel(s)}</em>
              </span>
              <span className="pv">
                {s.kind === "trading" ? money(s.grossSales) : opensWord(s.opensOn)}
                <em>{s.kind === "trading" ? `${count(s.orders)} orders` : "opens"}</em>
              </span>
            </button>
            <div className={open ? "ldrawer is-open" : "ldrawer"} id={panelId(s.id)}>
              <div className="lpanel">{s.panel}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** A date nobody has set is not a date. Never a guess at one — see `PreOpenStore`. */
function opensWord(on: Date | null): string {
  return on ? shortDate(on) : "No date"
}

/** Stable and unique per store, so `aria-controls` names a real element. */
function panelId(id: string): string {
  return `pstore-panel-${id}`
}
