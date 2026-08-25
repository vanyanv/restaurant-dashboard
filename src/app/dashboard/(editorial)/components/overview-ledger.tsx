"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  channelStampColor,
  foldChannelRowsByStore,
  type FoldedChannel,
} from "@/lib/dashboard/channel-fold"
import { shortStoreLabels } from "@/lib/dashboard/store-label"
import type { StoreSummaryRow } from "@/types/analytics"

/**
 * The overview's ledger: seven columns that foot, with each store's channel mix
 * nested underneath it and collapsible per store.
 *
 * Replaces the seventeen-column horizontal scroller the overview used to
 * render, which was built to reconcile a drawer. This one answers "how did the
 * day go, and where did it come from". /dashboard/analytics has its own shell
 * and never shared that component, so it goes with this change.
 *
 * The channel rows here are `storeChannelRows`, keyed
 * `<storeId>|||<platform>|||<paymentMethod>`. The account-wide `channelRows`
 * cannot be nested under a store — they aggregate every location, so hanging
 * them off Hollywood would read correctly only while Hollywood is the only
 * store trading, and would quietly start lying the day Glendale opens.
 */

const COLUMNS = ["Orders", "Gross", "Discounts", "Net", "Fees", "Payout"] as const

function money(n: number): string {
  const abs = Math.abs(Math.round(n))
  const s = `$${abs.toLocaleString()}`
  return n < 0 ? `(${s})` : s
}

function Cells({ row, channel }: { row?: StoreSummaryRow; channel?: FoldedChannel }) {
  const orders = row ? row.fulfilledOrders : channel!.orders
  const gross = row ? row.grossSales : channel!.gross
  const discounts = row ? row.discounts : channel!.discounts
  const net = row ? row.netSales : channel!.net
  const fees = row ? row.commissionFees : channel!.fees
  const payout = row ? row.expectedDeposit : channel!.payout

  return (
    <>
      <span className="ov-ledger__num">{Math.round(orders).toLocaleString()}</span>
      <span className="ov-ledger__num">{money(gross)}</span>
      <span className={cn("ov-ledger__num", discounts !== 0 && "is-cost")}>
        {money(discounts)}
      </span>
      <span className="ov-ledger__num">{money(net)}</span>
      <span className={cn("ov-ledger__num", fees !== 0 && "is-cost")}>
        {money(fees)}
      </span>
      <span className="ov-ledger__num">{money(payout)}</span>
    </>
  )
}

export function OverviewLedger({
  rows,
  totals,
  storeChannelRows,
  preOpenStoreIds,
  stamp,
}: {
  rows: StoreSummaryRow[]
  totals: StoreSummaryRow
  storeChannelRows: StoreSummaryRow[]
  preOpenStoreIds: string[]
  /** "Aug 19" — the range the ledger covers. */
  stamp: string
}) {
  const preOpen = new Set(preOpenStoreIds)
  const isDormant = (r: StoreSummaryRow) =>
    r.grossSales === 0 && r.netSales === 0 && r.fulfilledOrders === 0

  // Trading stores first; a store with no ledger to show is a footnote, not a
  // row of zeros above the one that traded.
  const ordered = [...rows].sort((a, b) => {
    const aQuiet = preOpen.has(a.storeId) && isDormant(a) ? 1 : 0
    const bQuiet = preOpen.has(b.storeId) && isDormant(b) ? 1 : 0
    return aQuiet - bQuiet || b.grossSales - a.grossSales
  })

  // "Chris N Eddys - " is on every row and therefore carries nothing.
  const labels = shortStoreLabels(ordered.map((r) => r.storeName))
  const labelOf = new Map(ordered.map((r, i) => [r.storeId, labels[i]]))

  const channelsByStore = foldChannelRowsByStore(storeChannelRows)
  const trading = ordered.filter((r) => !(preOpen.has(r.storeId) && isDormant(r)))

  // Open by default: with one trading store, collapsed hides the whole channel
  // mix behind a click for no gain. Collapsing is for when several stores are
  // trading and the ledger gets long.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const anyChannels = trading.some(
    (r) => (channelsByStore.get(r.storeId)?.length ?? 0) > 0
  )
  const allCollapsed =
    anyChannels && trading.every((r) => collapsed.has(r.storeId))

  return (
    <>
      {anyChannels && (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={() =>
              setCollapsed(
                allCollapsed ? new Set() : new Set(trading.map((r) => r.storeId))
              )
            }
            className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-(--ink-muted) transition-colors hover:text-(--accent)"
          >
            {allCollapsed ? "Show all channels" : "Hide all channels"}
          </button>
        </div>
      )}

      <div className="ov-ledger">
        <div className="ov-ledger__grid">
          <div className="ov-ledger__row ov-ledger__row--head">
            <span>Store</span>
            {COLUMNS.map((c) => (
              <span key={c} className="text-right">
                {c}
              </span>
            ))}
          </div>

          {ordered.map((r) => {
            const quiet = preOpen.has(r.storeId) && isDormant(r)
            if (quiet) {
              return (
                <div key={r.storeId} className="ov-ledger__row ov-ledger__row--note">
                  <span className="ov-ledger__store is-quiet">
                    {labelOf.get(r.storeId) ?? r.storeName}
                  </span>
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-(--ink-faint)">
                    Opening soon · no service yet
                  </span>
                </div>
              )
            }

            const channels = channelsByStore.get(r.storeId) ?? []
            const isOpen = channels.length > 0 && !collapsed.has(r.storeId)

            return (
              <div key={r.storeId}>
                <div className="ov-ledger__row group">
                  <span className="flex min-w-0 items-baseline gap-2">
                    {channels.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggle(r.storeId)}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Hide" : "Show"} channels for ${
                          labelOf.get(r.storeId) ?? r.storeName
                        }`}
                        className="ov-ledger__disclose"
                      >
                        <ChevronRight
                          className={cn(
                            "h-3 w-3 transition-transform",
                            isOpen && "rotate-90"
                          )}
                        />
                      </button>
                    )}
                    <Link
                      href={`/dashboard/analytics/${r.storeId}`}
                      className="ov-ledger__store inline-flex items-center gap-1 transition-colors hover:text-(--accent)"
                    >
                      {labelOf.get(r.storeId) ?? r.storeName}
                    </Link>
                    {channels.length > 0 && !isOpen && (
                      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-(--ink-faint)">
                        {channels.length} channels
                      </span>
                    )}
                  </span>
                  <Cells row={r} />
                </div>

                {isOpen &&
                  channels.map((c) => (
                    <div
                      key={`${r.storeId}-${c.kind}`}
                      className="ov-ledger__row ov-ledger__row--channel"
                    >
                      <span>
                        <span
                          className="platform-stamp"
                          style={{ color: channelStampColor(c.kind) }}
                        >
                          {c.label}
                        </span>
                      </span>
                      <Cells channel={c} />
                    </div>
                  ))}
              </div>
            )
          })}

          <div className="ov-ledger__row ov-ledger__row--total">
            <span className="ov-ledger__total-label">
              Total · {trading.length} store{trading.length === 1 ? "" : "s"} trading
              {" · "}
              {stamp}
            </span>
            <Cells row={totals} />
          </div>
        </div>
      </div>
    </>
  )
}
