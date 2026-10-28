"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Section, useCounterTransition, usePageChrome, useSurfaceHref } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { CustomerView, CustomersData, CustomersSections } from "@/lib/counter/adapters/shop"
import { ShopGlyphMark, ShopHead } from "../shop-ui"

/** Shop — Customers. One row per email; one customer opens beside the list with their orders. */
export function ShopCustomersClient({ sections }: { sections: SectionSources<CustomersSections> }) {
  usePageChrome({ leaf: "Customers" })
  const { pending } = useCounterTransition()
  return (
    <>
      <ShopHead sub="Everyone who has ordered from chrisneddys.com" />
      <Section bare title="Customers" data={sections.customers} pending={pending}>
        {(d) => <Customers data={d} />}
      </Section>
    </>
  )
}

function useGo() {
  const surface = useSurfaceHref()
  const router = useRouter()
  const { startTransition } = useCounterTransition()
  return (q: Record<string, string | null>) => {
    const sp = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(q)) {
      if (v === null || v === "") sp.delete(k)
      else sp.set(k, v)
    }
    const qs = sp.toString()
    startTransition(() => router.push(surface(qs ? `/dashboard/shop/customers?${qs}` : "/dashboard/shop/customers"), { scroll: false }))
  }
}

function Customers({ data }: { data: CustomersData }) {
  const go = useGo()
  const [q, setQ] = useState(data.query)
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <form
        className="ck-row"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          go({ q, customer: null })
        }}
      >
        <input className="ck-input" style={{ maxWidth: 320 }} placeholder="Name or email" aria-label="Find a customer" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn">
          Find
        </button>
        <span className="ck-mono">{data.rows.length} customers</span>
      </form>
      <div className="ck-split">
        <div className="sec">
          <div className="ck-tablewrap">
            <table className="ck-table sh-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Orders</th>
                  <th>Spent</th>
                  <th>Last order</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="ck-meta">
                      {data.query ? "Nobody matches that." : "No customers yet."}
                    </td>
                  </tr>
                )}
                {data.rows.map((c) => (
                  <tr key={c.key} className={data.selected?.key === c.key ? "sh-sel" : ""}>
                    <td>
                      <button type="button" className="ck-link" onClick={() => go({ customer: c.key })} aria-pressed={data.selected?.key === c.key}>
                        <b>{c.name}</b>
                      </button>
                      <div className="ck-meta">{c.email}</div>
                    </td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>
                      {c.orders}
                      {c.refunded > 0 && <span className="ck-meta"> · {c.refunded} refunded</span>}
                    </td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{c.spent}</td>
                    <td className="ck-meta">{c.last}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="sec">
          {data.selected ? <Drawer c={data.selected} onClose={() => go({ customer: null })} /> : <p className="sh-empty">Pick a customer to see their orders.</p>}
        </div>
      </div>
    </div>
  )
}

function Drawer({ c, onClose }: { c: CustomerView; onClose: () => void }) {
  const surface = useSurfaceHref()
  return (
    <div className="ck-drawer">
      <div className="ck-spread">
        <h3>{c.name}</h3>
        <button type="button" className="btn btn--quiet" onClick={onClose}>
          Close
        </button>
      </div>
      <dl className="ck-kv">
        <dt>Email</dt>
        <dd>
          <a href={`mailto:${c.email}`}>{c.email}</a>
        </dd>
        {c.phone && (
          <>
            <dt>Phone</dt>
            <dd>
              <a href={`tel:${c.phone}`}>{c.phone}</a>
            </dd>
          </>
        )}
        {c.city && (
          <>
            <dt>City</dt>
            <dd>{c.city}</dd>
          </>
        )}
        <dt>Orders</dt>
        <dd>
          {c.orders} · {c.spent}
          {c.refunded > 0 ? ` · ${c.refunded} refunded` : ""}
        </dd>
        {c.since && (
          <>
            <dt>Customer since</dt>
            <dd>{c.since}</dd>
          </>
        )}
        {c.numbers.length > 0 && (
          <>
            <dt>Owns</dt>
            <dd>{c.numbers.join(", ")}</dd>
          </>
        )}
      </dl>
      <div className="sh-queue">
        {c.history.map((o) => (
          <Link key={o.id} className="sh-order" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto", color: "inherit", textDecoration: "none" }} href={surface(`/dashboard/shop/orders?filter=all&order=${encodeURIComponent(o.id)}`)}>
            <ShopGlyphMark glyph={o.glyph} title={o.state} small />
            <span className="who">
              <b>
                #{o.number.replace(/^CNE-/, "")} · {o.placed}
              </b>
              <span className="what">{o.items}</span>
            </span>
            <span className="amt">{o.total}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
