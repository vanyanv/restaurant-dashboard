import type { CSSProperties, ReactNode } from "react"
import { commissionFor, channelById, markVarFor, type ChannelId } from "@/lib/counter/channels"
import { money, count } from "@/lib/counter/format"

/**
 * Where a store's money came from, and what it cost to collect it.
 *
 * Emitted inline inside `P.overview.desk()` — `chanPanel()` at line 3824 of
 * `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="chan">
 *   <div class="chan__cap">
 *     <span>Where Hollywood's $25,879 came from · Aug 1 – Aug 24</span>
 *     <span class="chan__key"><i class="k1"></i>keeps<i class="k2"></i>commission</span>
 *   </div>
 *   <div class="chan__row">
 *     <span class="chip" style="--pc:var(--ch-dd)"><i></i>DoorDash</span>
 *     <span class="cbar"><i style="width:21.7%"></i><u style="left:21.7%;width:7.2%"></u></span>
 *     <b>$7,483</b>
 *     <span class="cmeta">28.9% of net · 405 orders · $24.64 ticket ·
 *                         commission 25% −$2,494 · keeps <b>$7,483</b></span>
 *   </div>…
 *   <p class="chan__foot">…</p>
 *   <div class="btnrow">…</div>
 * </div>
 * ```
 *
 * ## The two encodings, and why they are not the same colour
 *
 * **Length is share of NET** — the whole `.cbar` track is the store's total,
 * and each row's filled part is that channel's slice of it. Inside that slice,
 * `<i>` is what the store keeps and `<u>` is what the marketplace took; `<u>`
 * is drawn as a diagonal hatch by the ported sheet, not as a second colour, so
 * "kept" and "taken" read as one bar with a texture rather than two categories.
 *
 * **Hue is identity only** — the brand colour lives on the `.chip i` swatch
 * beside the channel's own name, set through `--pc`. Notes 36 and 41: run the
 * four brand hexes through a colour-vision check and they clear only ΔE 8.5 as
 * a set, so a chart drawn in them is unreadable for a large minority. Beside a
 * text label they still do the one job they can do. Both come from
 * `src/lib/counter/channels.ts`; this file picks no colour.
 *
 * ## No rows is a state, not an error
 *
 * A store with no customers has no channels. `prePanel()` (prototype line 3860)
 * reuses the same `.chan` box for exactly that: a caption saying it is not
 * trading yet, and a footnote saying what it is waiting for. Passing an empty
 * `rows` renders that shape — the keeps/commission legend is suppressed
 * (nothing on screen for it to key) and the footnote loses its top margin, both
 * as the prototype does it.
 */
export interface ChannelRow {
  id: ChannelId
  /** This channel's net sales over the range, in dollars. */
  net: number
  /** Orders on this channel over the range. */
  orders: number
}

export function ChannelRows({
  caption,
  rows,
  footer,
  actions,
}: {
  /** The left half of `.chan__cap` — the sentence naming what these rows total to. */
  caption: ReactNode
  rows: ChannelRow[]
  /** `.chan__foot` — the paragraph that says what the rows add up to meaning. */
  footer?: ReactNode
  /** `.btnrow` — where the reader goes next. */
  actions?: ReactNode
}) {
  // A store whose range contains no sales at all: every share is 0%, and no
  // width is ever NaN.
  const total = rows.reduce((t, r) => t + r.net, 0)
  const shareOf = (v: number) => (total === 0 ? 0 : (v / total) * 100)

  return (
    <div className="chan">
      <div className="chan__cap">
        <span>{caption}</span>
        {rows.length > 0 ? (
          <span className="chan__key">
            <i className="k1" />
            keeps
            <i className="k2" />
            commission
          </span>
        ) : null}
      </div>

      {rows.map((r) => {
        const channel = channelById(r.id)
        const rate = commissionFor(r.id)
        const fee = r.net * rate
        const keep = r.net - fee
        const ticket = r.orders === 0 ? null : r.net / r.orders

        return (
          <div className="chan__row" key={r.id}>
            <span className="chip" style={{ "--pc": markVarFor(r.id) } as CSSProperties}>
              <i />
              {channel.name}
            </span>
            <span className="cbar">
              <i style={{ width: `${shareOf(keep).toFixed(1)}%` }} />
              {fee > 0 ? (
                <u
                  style={{
                    left: `${shareOf(keep).toFixed(1)}%`,
                    width: `${shareOf(fee).toFixed(1)}%`,
                  }}
                />
              ) : null}
            </span>
            <b>{money(r.net)}</b>
            <span className="cmeta">
              {shareOf(r.net).toFixed(1)}% of net · {count(r.orders)} orders ·{" "}
              {/* A channel with no orders has no ticket. `money` prints an
                  em-dash for a figure that does not exist, which is the right
                  answer HERE — it is a missing measurement on a row that has
                  every other figure, not a whole store reduced to dashes. */}
              {money(ticket, { cents: true })} ticket ·{" "}
              {rate > 0 ? (
                <>
                  commission {Math.round(rate * 100)}% −{money(fee)} · keeps <b>{money(keep)}</b>
                </>
              ) : (
                <>
                  no commission · keeps <b>{money(r.net)}</b>
                </>
              )}
            </span>
          </div>
        )
      })}

      {footer ? (
        <p className="chan__foot" style={rows.length === 0 ? { marginTop: 0 } : undefined}>
          {footer}
        </p>
      ) : null}
      {actions ? <div className="btnrow">{actions}</div> : null}
    </div>
  )
}
