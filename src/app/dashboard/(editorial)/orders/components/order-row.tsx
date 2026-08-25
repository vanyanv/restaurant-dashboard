"use client"

import { useRouter } from "next/navigation"
import { CheckCircle2, CircleDashed } from "lucide-react"
import { PlatformStamp } from "./platform-chip"
import type { OrderListRow } from "@/app/actions/order-actions"

type Props = {
  order: OrderListRow
  index: number
}

export function OrderRow({ order, index }: Props) {
  const router = useRouter()
  const dockClass = index < 12 ? `dock-in dock-in-${index + 1}` : ""

  const go = () => router.push(`/dashboard/orders/${order.id}`)

  const displayId =
    order.externalDisplayId ?? order.otterOrderId.slice(0, 8).toUpperCase()

  return (
    <button
      type="button"
      onClick={go}
      className={`order-row group ${dockClass}`}
      aria-label={`Order ${displayId} — ${order.customerName ?? "customer"} — ${order.storeName}`}
    >
      <div className="row-time">
        <div className="font-mono text-[13px] leading-tight text-[var(--ink)]">
          {formatTime(order.referenceTimeLocal)}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
          {formatDay(order.referenceTimeLocal)}
        </div>
      </div>

      <div className="row-id overflow-hidden">
        <div className="font-mono text-[11px] text-[var(--ink-muted)] truncate">
          {displayId}
        </div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--ink-faint)] truncate">
          {order.storeName}
        </div>
      </div>

      <div className="row-customer row-middle overflow-hidden">
        <div className="font-display text-[17px] leading-[1.15] text-[var(--ink)] truncate">
          {order.customerName ? (
            order.customerName
          ) : (
            <span className="italic text-[var(--ink-faint)]">no name</span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <PlatformStamp platform={order.platform} />
          {order.fulfillmentMode && (
            <span className="font-mono text-[10px] text-[var(--ink-faint)] uppercase tracking-[0.12em]">
              · {formatFulfillment(order.fulfillmentMode)}
            </span>
          )}
        </div>
      </div>

      <div className="row-platform row-items text-[var(--ink-muted)] text-center">
        <div className="font-display text-[20px] leading-none">
          {order.itemCount}
        </div>
        <div className="font-label mt-1 text-[9px]">
          item{order.itemCount === 1 ? "" : "s"}
        </div>
      </div>

      <div className="row-total text-right">
        <div className="font-display-tight total-num text-[22px] leading-none text-[var(--ink)]">
          {formatMoney(order.total)}
        </div>
        <div className="font-mono mt-1 text-[10px] text-[var(--ink-faint)]">
          sub ${order.subtotal.toFixed(2)}
        </div>
      </div>

      <div
        className="row-status flex justify-end text-[var(--ink-faint)]"
        aria-hidden="true"
      >
        {order.detailsFetched ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-[#1a7a4a]" />
        ) : (
          <CircleDashed className="h-3.5 w-3.5" />
        )}
      </div>
    </button>
  )
}

function formatTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d
  const h = date.getUTCHours()
  const m = date.getUTCMinutes().toString().padStart(2, "0")
  const h12 = ((h + 11) % 12) + 1
  const ampm = h < 12 ? "am" : "pm"
  return `${h12}:${m}${ampm}`
}

function formatDay(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d
  const mon = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" })
  const day = date.getUTCDate()
  return `${mon} ${day}`
}

function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`
}

function formatFulfillment(mode: string): string {
  return mode
    .replace("FULFILLMENT_MODE_", "")
    .replace(/_/g, " ")
    .toLowerCase()
}
