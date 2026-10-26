"use client"

import Link from "next/link"
import { Section, useCounterTransition, usePageChrome } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { OrderLine, TodayData, TodaySections } from "@/lib/counter/adapters/shop"
import { OrderRow, ShopGlyphMark, ShopHead, ShopLegend } from "./shop-ui"

/**
 * Shop — Today. The desk in one screen: late orders on top, then the ship
 * queue and the pickup counter, each with its one next step as a button, and
 * what is about to sell out. Sales sit at the bottom: they are a glance, not
 * a job.
 */
export function ShopTodayClient({ sections }: { sections: SectionSources<TodaySections> }) {
  usePageChrome({
    leaf: "Shop",
    askSuggestions: ["What sold best on the shop this month?", "Which shop orders are late?"],
  })
  const { pending } = useCounterTransition()

  return (
    <>
      <ShopHead sub="chrisneddys.com merch · orders, stock and pickup" />
      <Section bare title="Needs you" data={sections.today} pending={pending}>
        {(d) => <Top data={d} />}
      </Section>
      <Section title="To ship" meta={(d) => `${d.toShip.length} waiting`} data={sections.today} pending={pending} pad={false}>
        {(d) => <Queue rows={d.toShip} empty="Nothing to ship. Every paid order is out the door." />}
      </Section>
      <Section
        title="Pickup"
        meta={(d) => (d.pickupAddress ? d.pickupAddress : "Pickup is off")}
        data={sections.today}
        pending={pending}
        pad={false}
      >
        {(d) => <Queue rows={d.pickup} empty="No pickup orders waiting." />}
      </Section>
      <div className="ck-split">
        <Section title="Sales, last 7 days" meta={(d) => `${d.sales7.orders} orders`} data={sections.today} pending={pending}>
          {(d) => <Sales data={d} />}
        </Section>
        <Section title="Running low" meta={(d) => (d.lowStock.length ? `${d.lowStock.length} items` : undefined)} data={sections.today} pending={pending} pad={false}>
          {(d) => <Low data={d} />}
        </Section>
      </div>
      <div style={{ padding: "4px 2px" }}>
        <ShopLegend />
      </div>
    </>
  )
}

function Top({ data }: { data: TodayData }) {
  const c = data.counts
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {data.paused && (
        <div className="sh-banner" role="status">
          <ShopGlyphMark glyph="late" title="Shop paused" />
          <span>
            <b>The shop is paused.</b> <span className="ck-meta">{data.paused.note ?? "Customers can look but not buy."}</span>
          </span>
          <Link className="btn" href="/dashboard/shop/settings">
            Open settings
          </Link>
        </div>
      )}
      {data.late.length > 0 && (
        <div className="ck-alerts">
          {data.late.map((o) => (
            <div className="ck-alert" key={o.id}>
              <ShopGlyphMark glyph="late" />
              <span>
                <b>
                  #{o.number.replace(/^CNE-/, "")} paid {o.placed} and not shipped.
                </b>{" "}
                <span className="ck-meta">
                  {o.customer} · {o.items}
                </span>
              </span>
              <Link className="btn" href={`/dashboard/shop/orders?order=${encodeURIComponent(o.id)}`}>
                Open order
              </Link>
            </div>
          ))}
        </div>
      )}
      <div className="sh-tiles">
        <Tile k="To ship" v={c.toShip} s={c.lateToShip ? `${c.lateToShip} late` : "None late"} bad={c.lateToShip > 0} href="/dashboard/shop/orders" />
        <Tile k="To bag" v={c.toBag} s="Pickup orders to pack" href="/dashboard/shop/orders" />
        <Tile k="At the counter" v={c.readyForPickup} s="Bagged, waiting for the customer" href="/dashboard/shop/orders" />
        <Tile k="Done this week" v={c.doneLast7} s="Shipped or picked up" href="/dashboard/shop/orders?filter=all" />
      </div>
    </div>
  )
}

function Tile({ k, v, s, bad, href }: { k: string; v: number; s: string; bad?: boolean; href: string }) {
  return (
    <Link className={`sh-tile${bad ? " sh-tile--bad" : ""}`} href={href}>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      <span className="s">{s}</span>
    </Link>
  )
}

function Queue({ rows, empty }: { rows: OrderLine[]; empty: string }) {
  if (rows.length === 0) return <p className="sh-empty">{empty}</p>
  return (
    <div className="sh-queue">
      {rows.map((o) => (
        <OrderRow key={o.id} o={o} href={`/dashboard/shop/orders?order=${encodeURIComponent(o.id)}`} />
      ))}
    </div>
  )
}

function Sales({ data }: { data: TodayData }) {
  const max = Math.max(1, ...data.sales7.days.map((d) => d.cents))
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="ck-spread">
        <span className="sh-tile" style={{ border: 0, padding: 0 }}>
          <span className="v">{data.sales7.total}</span>
          <span className="s">{data.sales7.refunded === "$0.00" ? "No refunds" : `${data.sales7.refunded} refunded`}</span>
        </span>
      </div>
      <div className="sh-spark" role="img" aria-label={data.sales7.days.map((d) => `${d.label} ${d.amount}`).join(", ")}>
        {data.sales7.days.map((d) => (
          <span key={d.label} title={`${d.label} · ${d.amount}`}>
            <i style={{ height: `${Math.round((d.cents / max) * 64)}px` }} />
            <em>{d.label}</em>
          </span>
        ))}
      </div>
    </div>
  )
}

function Low({ data }: { data: TodayData }) {
  if (data.lowStock.length === 0) return <p className="sh-empty">Nothing is close to selling out.</p>
  return (
    <table className="ck-table">
      <tbody>
        {data.lowStock.map((p) => (
          <tr key={p.productId}>
            <td>
              <Link className="sh-rowlink" href={`/dashboard/shop/products?product=${encodeURIComponent(p.productId)}`}>
                <b>{p.name}</b>
              </Link>
            </td>
            <td className={p.out ? "sh-low" : ""} style={{ textAlign: "right" }}>
              {p.left}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
