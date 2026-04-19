"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, RefreshCw, AlertCircle } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  refetchOrderDetail,
  type OrderDetail,
} from "@/app/actions/order-actions"
import { PlatformStamp } from "../components/platform-chip"

type Props = {
  order: OrderDetail
}

export function OrderDetailContent({ order }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  const displayId =
    order.externalDisplayId ?? order.otterOrderId.slice(0, 8).toUpperCase()

  function handleRefetch() {
    setMessage(null)
    startTransition(async () => {
      const result = await refetchOrderDetail(order.id)
      if (result.ok) {
        router.refresh()
      } else {
        setMessage(result.message ?? "Refetch failed")
      }
    })
  }

  const itemsComputed = order.items.reduce(
    (sum, it) => sum + it.price * it.quantity,
    0
  )

  return (
    <>
      {/* ─── Top strip ─── */}
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-[var(--hairline)] bg-[color-mix(in_srgb,var(--paper)_90%,transparent)] px-6 backdrop-blur-md">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-1 h-4" />
        <Link
          href="/dashboard/orders"
          className="flex items-center gap-1.5 text-[12px] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          <span className="font-label">All orders</span>
        </Link>
        <Separator orientation="vertical" className="mx-2 h-4" />
        <span className="font-mono text-[11px] text-[var(--ink-muted)]">
          ORDER · {displayId}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefetch}
            disabled={pending}
            className="toolbar-btn inline-flex items-center gap-1.5"
          >
            <RefreshCw
              className={`h-3 w-3 ${pending ? "animate-spin" : ""}`}
            />
            <span>Re-fetch</span>
          </button>
        </div>
      </header>

      {message && (
        <div className="mx-6 mt-4 flex items-center gap-2 border border-[var(--accent)] bg-[var(--accent-bg)] px-4 py-2 text-[12px] text-[var(--accent-dark)]">
          <AlertCircle className="h-3.5 w-3.5" />
          {message}
        </div>
      )}

      {/* ─── Masthead ─── */}
      <section className="px-6 pt-12 pb-10 border-b border-[var(--hairline)] dock-in dock-in-1">
        <div className="grid grid-cols-[1fr_auto] items-end gap-8">
          <div>
            <div className="font-label mb-2">Display ID</div>
            <h1 className="font-display-tight text-[64px] leading-[0.9] md:text-[96px]">
              {displayId}
            </h1>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
              <PlatformStamp platform={order.platform} size="md" />
              <span className="font-label text-[var(--ink-muted)]">
                {order.storeName}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                {formatLongDate(order.referenceTimeLocal)}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="font-label">Customer</div>
            <div className="font-display mt-1 text-[22px] italic leading-tight md:text-[28px]">
              {order.customerName ?? (
                <span className="text-[var(--ink-faint)]">anonymous</span>
              )}
            </div>
            {order.fulfillmentMode && (
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                {formatFulfillment(order.fulfillmentMode)}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ─── Manifest + ledger ─── */}
      <div className="grid gap-0 border-b border-[var(--hairline)] md:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        {/* Items manifest */}
        <section className="px-6 py-8 md:border-r md:border-[var(--hairline)] dock-in dock-in-2">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="font-display text-[22px] leading-none">Manifest</h2>
            <span className="font-label">
              {order.items.length} item{order.items.length === 1 ? "" : "s"}
            </span>
          </div>

          {order.items.length === 0 ? (
            <div className="border border-dashed border-[var(--hairline-bold)] p-8 text-center">
              <p className="font-display text-[20px] leading-tight">
                No items captured.
              </p>
              <p className="mt-2 text-[12px] text-[var(--ink-muted)]">
                Hit <em className="not-italic font-semibold">Re-fetch</em>{" "}
                above to pull them from Otter.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--hairline)]">
              {order.items.map((item) => (
                <ItemBlock key={item.id} item={item} />
              ))}
            </ul>
          )}
        </section>

        {/* Ledger */}
        <aside className="px-6 py-8 bg-[rgba(255,255,255,0.4)] md:sticky md:top-14 md:self-start dock-in dock-in-3">
          <div className="font-label mb-3">Receipt</div>
          <div>
            <div className="font-display-tight text-[56px] leading-[0.9] md:text-[72px]">
              ${splitMoney(order.total).whole}
              <span className="text-[var(--ink-muted)] text-[0.5em] tabular-nums">
                .{splitMoney(order.total).cents}
              </span>
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
              Total paid
            </div>
          </div>

          <div className="perforation mt-8">
            <span className="font-mono text-[9px] tracking-[0.2em]">
              LEDGER
            </span>
          </div>

          <dl className="space-y-1.5 font-mono text-[12.5px]">
            <LedgerRow label="Items subtotal" value={itemsComputed} muted />
            <LedgerRow label="Subtotal (Otter)" value={order.subtotal} />
            <LedgerRow label="Tax" value={order.tax} />
            {order.tip !== 0 && <LedgerRow label="Tip" value={order.tip} />}
            {order.discount !== 0 && (
              <LedgerRow label="Discount" value={order.discount} />
            )}
            {order.commission !== 0 && (
              <LedgerRow label="Commission" value={order.commission} />
            )}
          </dl>

          <div className="perforation mt-5 mb-3">
            <span className="font-mono text-[9px] tracking-[0.2em]">
              ═══
            </span>
          </div>

          <div className="flex items-baseline justify-between font-mono">
            <span className="font-label text-[var(--ink)]">Net Total</span>
            <span className="font-display-tight text-[22px]">
              ${order.total.toFixed(2)}
            </span>
          </div>
        </aside>
      </div>

      {/* ─── Footer metadata ─── */}
      <footer className="px-6 py-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink-faint)] space-y-1">
          <div>
            OTTER-ID · <span className="text-[var(--ink-muted)]">{order.otterOrderId}</span>
          </div>
          {order.detailsFetchedAt && (
            <div>
              DETAILS-SYNCED ·{" "}
              <span className="text-[var(--ink-muted)]">
                {formatTimestamp(order.detailsFetchedAt)}
              </span>
            </div>
          )}
          <div>
            HEADER-SYNCED ·{" "}
            <span className="text-[var(--ink-muted)]">
              {formatTimestamp(order.syncedAt)}
            </span>
          </div>
          {order.orderStatus && (
            <div>
              STATUS ·{" "}
              <span className="text-[var(--ink-muted)]">{order.orderStatus}</span>
            </div>
          )}
        </div>
      </footer>
    </>
  )
}

function ItemBlock({
  item,
}: {
  item: OrderDetail["items"][number]
}) {
  const groups = groupBySubHeader(item.subItems)
  const lineTotal = item.price * item.quantity

  return (
    <li className="py-5 first:pt-0 last:pb-0 group/item">
      <div className="grid grid-cols-[auto_1fr_auto] items-baseline gap-4">
        <span className="font-display-tight text-[26px] leading-none text-[var(--ink)] md:text-[32px]">
          {item.quantity}
          <span className="text-[var(--ink-faint)]">×</span>
        </span>
        <div>
          <div className="font-display text-[19px] leading-[1.15] md:text-[22px]">
            {item.name}
          </div>
          <div className="mt-1 font-mono text-[10px] text-[var(--ink-faint)] uppercase tracking-[0.12em] opacity-0 group-hover/item:opacity-100 transition-opacity">
            sku · {item.skuId}
          </div>
        </div>
        <div className="font-display-tight text-[20px] tabular-nums text-[var(--ink)]">
          ${lineTotal.toFixed(2)}
        </div>
      </div>

      {groups.length > 0 && (
        <ul className="mt-4 ml-8 space-y-3 border-l border-[var(--hairline)] pl-4">
          {groups.map((group, gi) => (
            <li key={gi}>
              {group.header && (
                <div className="font-label mb-1.5 text-[9px]">
                  {group.header}
                </div>
              )}
              <ul className="space-y-1">
                {group.items.map((si) => {
                  const isRemove = /^(remove|no\b|without\b)/i.test(si.name)
                  return (
                    <li
                      key={si.id}
                      className={`flex items-baseline justify-between gap-3 text-[13px] ${
                        isRemove
                          ? "text-[var(--subtract)]"
                          : "text-[var(--ink-muted)]"
                      }`}
                    >
                      <span>
                        <span className="font-mono mr-1.5 text-[10px] text-[var(--ink-faint)]">
                          {si.quantity}×
                        </span>
                        {si.name}
                      </span>
                      {si.price > 0 && (
                        <span className="font-mono text-[11px] text-[var(--ink)]">
                          ${(si.price * si.quantity).toFixed(2)}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function LedgerRow({
  label,
  value,
  muted,
}: {
  label: string
  value: number
  muted?: boolean
}) {
  const { whole, cents } = splitMoney(value)
  const sign = value < 0 ? "-" : ""
  return (
    <div
      className={`flex items-baseline justify-between ${
        muted ? "text-[var(--ink-faint)]" : ""
      }`}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">
        {sign}${whole}
        <span className="text-[var(--ink-faint)]">.{cents}</span>
      </dd>
    </div>
  )
}

function groupBySubHeader(
  subItems: OrderDetail["items"][number]["subItems"]
): Array<{
  header: string | null
  items: OrderDetail["items"][number]["subItems"]
}> {
  const groups: Array<{
    header: string | null
    items: OrderDetail["items"][number]["subItems"]
  }> = []
  for (const si of subItems) {
    const last = groups[groups.length - 1]
    if (last && last.header === si.subHeader) {
      last.items.push(si)
    } else {
      groups.push({ header: si.subHeader, items: [si] })
    }
  }
  return groups
}

function splitMoney(n: number): { whole: string; cents: string } {
  const abs = Math.abs(n)
  const [w, c = "00"] = abs.toFixed(2).split(".")
  return {
    whole: Number(w).toLocaleString(),
    cents: c,
  }
}

function formatLongDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d
  const mon = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" })
  const day = date.getUTCDate()
  const year = date.getUTCFullYear()
  const h = date.getUTCHours()
  const m = date.getUTCMinutes().toString().padStart(2, "0")
  const h12 = ((h + 11) % 12) + 1
  const ampm = h < 12 ? "am" : "pm"
  return `${mon} ${day}, ${year} · ${h12}:${m}${ampm}`
}

function formatTimestamp(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d
  return date.toISOString().replace("T", " ").slice(0, 19) + "z"
}

function formatFulfillment(mode: string): string {
  return mode
    .replace("FULFILLMENT_MODE_", "")
    .replace(/_/g, " ")
    .toLowerCase()
}
