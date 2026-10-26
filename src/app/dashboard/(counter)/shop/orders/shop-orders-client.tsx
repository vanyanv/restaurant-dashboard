"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Section, useCounterTransition, usePageChrome } from "@/components/counter"
import { markOrderPickedUp, markOrderReady } from "@/lib/counter/actions/shop"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { OrderView, OrdersData, OrdersSections } from "@/lib/counter/adapters/shop"
import { NEXT_STEP_LABEL, ORDER_TABS } from "@/lib/shop/status"
import { OutcomeLine, RefundForm, ShipForm, ShopGlyphMark, ShopHead, ShopLegend, useShopAction } from "../shop-ui"

/**
 * Shop — Orders. The list by status on the left; the open order on the
 * right with its address, lines, timeline and the one next step. The
 * selection lives in `?order=`, so a link from Today or a customer lands on
 * the same view.
 */
export function ShopOrdersClient({ sections }: { sections: SectionSources<OrdersSections> }) {
  usePageChrome({ leaf: "Orders" })
  const { pending } = useCounterTransition()
  return (
    <>
      <ShopHead sub="Every chrisneddys.com order · newest first" />
      <Section bare title="Orders" data={sections.orders} pending={pending}>
        {(d) => <Orders data={d} />}
      </Section>
    </>
  )
}

function useGo() {
  const router = useRouter()
  const { startTransition } = useCounterTransition()
  return (q: Record<string, string | null>) => {
    const sp = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(q)) {
      if (v === null) sp.delete(k)
      else sp.set(k, v)
    }
    const qs = sp.toString()
    startTransition(() => router.push(qs ? `/dashboard/shop/orders?${qs}` : "/dashboard/shop/orders", { scroll: false }))
  }
}

function Orders({ data }: { data: OrdersData }) {
  const go = useGo()
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="ck-spread">
        <div className="seg" role="group" aria-label="Show">
          {ORDER_TABS.map((t) => (
            <button key={t.filter} type="button" aria-pressed={data.filter === t.filter} onClick={() => go({ filter: t.filter, cursor: null })}>
              {t.label}
            </button>
          ))}
        </div>
        <ShopLegend />
      </div>
      <div className="ck-split">
        <div className="sec">
          <div className="ck-tablewrap">
            <table className="ck-table">
              <thead>
                <tr>
                  <th />
                  <th>Order</th>
                  <th>Items</th>
                  <th>Placed</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="ck-meta">
                      {data.filter === "open" ? "Nothing waiting. Every paid order is out the door." : "No orders here."}
                    </td>
                  </tr>
                )}
                {data.rows.map((o) => (
                  <tr key={o.id} className={data.selected?.id === o.id ? "sh-sel" : ""}>
                    <td>
                      <ShopGlyphMark glyph={o.glyph} title={o.stateLabel} small />
                    </td>
                    <td>
                      <button type="button" className="ck-link" onClick={() => go({ order: o.id })} aria-pressed={data.selected?.id === o.id}>
                        <b>#{o.number.replace(/^CNE-/, "")}</b> {o.customer}
                      </button>
                      <div className="ck-meta">
                        {o.stateLabel} · {o.fulfilment === "ship" ? "Ship" : "Pickup"}
                      </div>
                    </td>
                    <td className="ck-meta">{o.items}</td>
                    <td className="ck-meta">{o.placed}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{o.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(data.cursor || data.nextCursor) && (
            <div className="ck-spread" style={{ padding: "10px 14px", borderTop: "1px solid var(--line)" }}>
              {data.cursor ? (
                <button type="button" className="btn btn--quiet" onClick={() => go({ cursor: null })}>
                  Back to newest
                </button>
              ) : (
                <span />
              )}
              {data.nextCursor && (
                <button type="button" className="btn" onClick={() => go({ cursor: data.nextCursor })}>
                  Older orders
                </button>
              )}
            </div>
          )}
        </div>
        <div className="sec">
          {data.selected ? (
            <OrderDrawer key={`${data.selected.id}-${data.selected.status}`} o={data.selected} onClose={() => go({ order: null })} />
          ) : (
            <p className="sh-empty">Pick an order to see its address, items and what happens next.</p>
          )}
        </div>
      </div>
    </div>
  )
}

export function OrderDrawer({ o, onClose }: { o: OrderView; onClose: () => void }) {
  const { busy, outcome, run } = useShopAction()
  const [refunding, setRefunding] = useState(false)
  const hasEdition = o.lines.some((l) => l.detail.includes("Number "))
  return (
    <div className="ck-drawer">
      <div className="ck-spread">
        <h3>
          #{o.number.replace(/^CNE-/, "")} · {o.customer}
        </h3>
        <button type="button" className="btn btn--quiet" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="ck-st" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ShopGlyphMark glyph={o.glyph} />
        <b>{o.stateLabel}</b>
      </div>

      {o.next === "ship" && <ShipForm orderId={o.id} />}
      {o.next === "ready" && (
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(() => markOrderReady({ orderId: o.id }))}>
          {busy ? "Saving…" : NEXT_STEP_LABEL.ready}
        </button>
      )}
      {o.next === "picked_up" && (
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(() => markOrderPickedUp({ orderId: o.id }))}>
          {busy ? "Saving…" : NEXT_STEP_LABEL.picked_up}
        </button>
      )}
      <OutcomeLine outcome={outcome} />

      <dl className="ck-kv">
        <dt>Email</dt>
        <dd>{o.email ? <a href={`mailto:${o.email}`}>{o.email}</a> : "None"}</dd>
        {o.phone && (
          <>
            <dt>Phone</dt>
            <dd>
              <a href={`tel:${o.phone}`}>{o.phone}</a>
            </dd>
          </>
        )}
        <dt>{o.fulfilment === "ship" ? "Ship to" : "Pickup"}</dt>
        <dd>
          {o.shipTo ? (
            <address className="sh-addr">
              {o.shipTo.map((l) => (
                <div key={l}>{l}</div>
              ))}
            </address>
          ) : (
            "At the counter"
          )}
        </dd>
        {o.trackingNumber && (
          <>
            <dt>Tracking</dt>
            <dd>
              {o.carrier} · <span className="ck-mono">{o.trackingNumber}</span>
            </dd>
          </>
        )}
      </dl>

      <ul className="sh-lines">
        {o.lines.map((l) => (
          <li key={l.id}>
            <b>
              {l.qty} × {l.name}
            </b>
            <span className="amt">{l.price}</span>
            {l.detail && <span className="ck-mono">{l.detail}</span>}
          </li>
        ))}
      </ul>
      <div className="sh-totals">
        <span>Subtotal</span>
        <span>{o.subtotal}</span>
        <span>Shipping</span>
        <span>{o.shipping}</span>
        <span>Tax</span>
        <span>{o.tax}</span>
        <b>Total</b>
        <b>{o.total}</b>
      </div>

      <dl className="ck-kv">
        {o.timeline.map((t) => (
          <FragmentRow key={t.label} k={t.label} v={t.at} />
        ))}
      </dl>
      {o.notes.length > 0 && (
        <div className="ck-meta">
          {o.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      )}

      {o.canRefund &&
        (refunding ? (
          <RefundForm orderId={o.id} hasEdition={hasEdition} onDone={() => setRefunding(false)} />
        ) : (
          <div className="ck-row">
            <button type="button" className="btn btn--quiet" onClick={() => setRefunding(true)}>
              Mark refunded…
            </button>
            {o.stripeUrl && (
              <a className="btn btn--quiet" href={o.stripeUrl} target="_blank" rel="noreferrer">
                Open in Stripe
              </a>
            )}
          </div>
        ))}
    </div>
  )
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  )
}
