import type { CSSProperties, ReactNode } from "react"
import { channelById, markVarFor, type ChannelId } from "@/lib/counter/channels"
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
 *
 * ## Where this diverges from the prototype's `commission 25% −$2,494`
 *
 * The markup above is the ported sheet's, and its `25%` is DoorDash's
 * trade-average rate — a constant, the same for every store. This component
 * used to reproduce that exactly, reading the rate from `channels.ts`'s
 * `commissionFor` and multiplying it by the row's own net. That was fabricated
 * for any store whose real contract differs from the trade average, and it
 * was fabricated OUTRIGHT for Grubhub, which has no published rate at all —
 * `commissionFor("grubhub")` returned a made-up `0.20` and drew a bar for it.
 *
 * The fee now comes from `ChannelReading.commission` (`channel-mix.ts`), the
 * one place a commission is derived: the STORE's own contract rate against
 * gross, the same basis the P&L's commission lines use. A row here can no
 * longer print a percent, because with multi-store aggregation there is no
 * single rate behind the dollar figure — a dollar total is the honest thing to
 * show, so the meta line reads `commission −$1,870 · keeps $5,609`, with no
 * rate before it. And a row can genuinely have no rate on file (Grubhub): that
 * prints `commission rate not on file · keeps —`, not a `0%` that would claim
 * the marketplace works for free.
 */
export interface ChannelRow {
  id: ChannelId
  /** This channel's net sales over the range, in dollars. */
  net: number
  /** Orders on this channel over the range. */
  orders: number
  /**
   * What the marketplace kept, in dollars — `ChannelReading.commission`,
   * passed through unchanged. `0` for in-house, genuinely none. `null` when
   * the schema publishes no rate (Grubhub): never coalesced to `0`, which
   * would claim that marketplace works for free.
   */
  commission: number | null
  /**
   * `ChannelReading.ticket` passed through: `net / orders`, `null` when the
   * channel had no orders. Never `0` — a channel with no orders has no
   * average ticket.
   */
  ticket: number | null
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
        // The store's own reading, not a trade-average constant: `0` is
        // genuinely no commission (in-house), `null` is no published rate
        // (Grubhub) — see the module docblock above.
        const fee = r.commission
        const keep = fee === null ? null : r.net - fee
        // fee>0: the kept slice is narrower than the channel's share of net,
        // and the hatch fills the rest. fee 0 or null: nothing was taken (or
        // nothing is known to have been), so the kept bar fills the whole
        // slice and there is no hatch.
        //
        // `fee` is the store's rate against GROSS (`channel-mix.ts`); `keep`
        // here is against THIS row's net. A high rate on a heavily discounted
        // range can push fee past net, so `keep` can go negative — clamped to
        // 0 for the geometry (an unclamped negative width is silently
        // dropped by the browser) rather than for the meta line, which still
        // prints the honest `($50)`. The hatch is capped the same way, so
        // `left + width` never draws past this channel's own share of net.
        const keepWidth = fee !== null && fee > 0 ? Math.max(0, keep!) : r.net
        const feeWidth = fee !== null && fee > 0 ? Math.min(fee, r.net - keepWidth) : 0

        return (
          <div className="chan__row" key={r.id}>
            <span className="chip" style={{ "--pc": markVarFor(r.id) } as CSSProperties}>
              <i />
              {channel.name}
            </span>
            <span className="cbar">
              <i style={{ width: `${shareOf(keepWidth).toFixed(1)}%` }} />
              {fee !== null && fee > 0 ? (
                <u
                  style={{
                    left: `${shareOf(keepWidth).toFixed(1)}%`,
                    width: `${shareOf(feeWidth).toFixed(1)}%`,
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
              {money(r.ticket, { cents: true })} ticket ·{" "}
              {fee === null ? (
                <>
                  commission rate not on file · keeps {money(null)}
                </>
              ) : fee > 0 ? (
                <>
                  commission −{money(fee)} · keeps <b>{money(keep!)}</b>
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
