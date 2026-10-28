"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Section, useCounterTransition, usePageChrome, useSurfaceHref } from "@/components/counter"
import { createShopProduct, saveShopProduct, setShopProductStatus, setShopProductStock } from "@/lib/counter/actions/shop"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { ProductEdit, ProductLine, ProductsData, ProductsSections, StockView } from "@/lib/counter/adapters/shop"
import { OutcomeLine, ShopHead, useShopAction } from "../shop-ui"

/**
 * Shop — Products. The rack as a table: photo, name, price, stock and
 * status, with stock editable in the row. One product opens beside it for
 * its words, price and status. Photos, numbered-edition runs and SEO stay on
 * the site's own editor for now, linked from the drawer.
 */
export function ShopProductsClient({ sections }: { sections: SectionSources<ProductsSections> }) {
  usePageChrome({ leaf: "Products" })
  const { pending } = useCounterTransition()
  return (
    <>
      <ShopHead sub="What's for sale on chrisneddys.com" />
      <Section bare title="Products" data={sections.products} pending={pending}>
        {(d) => <Products data={d} />}
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
      if (v === null) sp.delete(k)
      else sp.set(k, v)
    }
    const qs = sp.toString()
    startTransition(() => router.push(surface(qs ? `/dashboard/shop/products?${qs}` : "/dashboard/shop/products"), { scroll: false }))
  }
}

function Products({ data }: { data: ProductsData }) {
  const go = useGo()
  const [adding, setAdding] = useState(false)
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="ck-spread">
        <div className="seg" role="group" aria-label="Show">
          <button type="button" aria-pressed={!data.archived} onClick={() => go({ archived: null, product: null })}>
            On the rack
          </button>
          <button type="button" aria-pressed={data.archived} onClick={() => go({ archived: "1", product: null })}>
            Archived
          </button>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "New product"}
        </button>
      </div>
      {adding && <NewProduct onCreated={(id) => { setAdding(false); go({ archived: null, product: id }) }} />}
      <div className="ck-split">
        <div className="sec">
          <div className="ck-tablewrap">
            <table className="ck-table sh-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="ck-meta">
                      {data.archived ? "Nothing archived." : "No products yet."}
                    </td>
                  </tr>
                )}
                {data.rows.map((p) => (
                  <Row key={p.id} p={p} selected={data.selected?.id === p.id} onOpen={() => go({ product: p.id })} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="sec">
          {data.selected ? (
            <Editor key={`${data.selected.id}-${data.selected.stage}-${data.selected.priceCents}`} p={data.selected} onClose={() => go({ product: null })} />
          ) : (
            <p className="sh-empty">Pick a product to edit its name, price, words or status.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ p, selected, onOpen }: { p: ProductLine; selected: boolean; onOpen: () => void }) {
  return (
    <tr className={selected ? "sh-sel" : ""}>
      <td>
        <span className="sh-pname">
          {p.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- served by chrisneddys.com, not this app
            <img className="sh-thumb" src={p.thumb} alt="" loading="lazy" />
          ) : (
            <span className="sh-thumb sh-thumb--none" aria-hidden />
          )}
          <button type="button" className="ck-link" onClick={onOpen} aria-pressed={selected}>
            <b>{p.name}</b>
          </button>
        </span>
      </td>
      <td style={{ fontVariantNumeric: "tabular-nums" }}>{p.price}</td>
      <td>
        <Stock productId={p.id} stock={p.stock} />
      </td>
      <td>
        <span className="ck-mono">{p.stage}</span>
      </td>
    </tr>
  )
}

/** A count is set in the row; an edition's numbers and an uncounted item only say where they stand. */
function Stock({ productId, stock }: { productId: string; stock: StockView }) {
  const [value, setValue] = useState(stock.mode === "quantity" ? String(stock.count) : "")
  const { busy, outcome, run } = useShopAction()
  if (stock.mode !== "quantity") {
    return <span className={stock.mode === "edition" && stock.low ? "sh-low" : "ck-meta"}>{stock.label}</span>
  }
  const n = Number(value)
  const changed = value !== "" && Number.isInteger(n) && n >= 0 && n !== stock.count
  return (
    <form
      className="sh-stock"
      onSubmit={(e) => {
        e.preventDefault()
        if (changed) run(() => setShopProductStock({ productId, count: n }))
      }}
    >
      <input
        className={`ck-input${stock.low ? " sh-low" : ""}`}
        inputMode="numeric"
        aria-label="In stock"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
      {changed && (
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "…" : "Save"}
        </button>
      )}
      <OutcomeLine outcome={outcome} />
    </form>
  )
}

function NewProduct({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("")
  const { busy, outcome, run } = useShopAction()
  return (
    <form
      className="sh-form sec"
      onSubmit={(e) => {
        e.preventDefault()
        run(() => createShopProduct({ name }), (r) => {
          const id = (r as { id?: string }).id
          if (id) onCreated(id)
        })
      }}
    >
      <div className="row">
        <label className="ck-field">
          <span className="ck-mono">Working name · only you see this</span>
          <input className="ck-input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus maxLength={120} />
        </label>
        <button type="submit" className="btn btn--primary" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create draft"}
        </button>
      </div>
      <span className="ck-meta">
        It starts as a draft. Add photos on the site&apos;s editor, then put it live here. <OutcomeLine outcome={outcome} />
      </span>
    </form>
  )
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2)
}

function Editor({ p, onClose }: { p: ProductEdit; onClose: () => void }) {
  const [v, setV] = useState({
    displayName1: p.displayName1,
    displayName2: p.displayName2,
    eyebrow: p.eyebrow,
    description: p.description,
    price: dollars(p.priceCents),
    perOrderLimit: String(p.perOrderLimit),
  })
  const save = useShopAction()
  const status = useShopAction()
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [k]: e.target.value }))

  const priceCents = Math.round(Number(v.price) * 100)
  const limit = Number(v.perOrderLimit)
  const diff = {
    displayName1: v.displayName1.trim() !== p.displayName1 ? v.displayName1.trim() : undefined,
    displayName2: v.displayName2.trim() !== p.displayName2 ? v.displayName2.trim() : undefined,
    eyebrow: v.eyebrow.trim() !== p.eyebrow ? v.eyebrow.trim() : undefined,
    description: v.description.trim() !== p.description ? v.description.trim() : undefined,
    priceCents: Number.isFinite(priceCents) && priceCents !== p.priceCents ? priceCents : undefined,
    perOrderLimit: Number.isInteger(limit) && limit !== p.perOrderLimit ? limit : undefined,
  }
  const dirty = Object.values(diff).some((x) => x !== undefined)
  const badPrice = !/^\d+(\.\d{1,2})?$/.test(v.price.trim())

  return (
    <div className="ck-drawer">
      <div className="ck-spread">
        <h3>{p.name}</h3>
        <button type="button" className="btn btn--quiet" onClick={onClose}>
          Close
        </button>
      </div>
      {p.photos.length > 0 && (
        <div className="sh-photos">
          {p.photos.slice(0, 4).map((ph) => (
            // eslint-disable-next-line @next/next/no-img-element -- served by chrisneddys.com, not this app
            <img key={ph.id} src={ph.url} alt={ph.alt} loading="lazy" />
          ))}
        </div>
      )}
      <dl className="ck-kv">
        <dt>Status</dt>
        <dd>{p.stage}{p.publishedAt ? ` · since ${p.publishedAt}` : ""}</dd>
        <dt>Stock</dt>
        <dd className={p.stock.mode !== "untracked" && p.stock.low ? "sh-low" : ""}>{p.stock.label}</dd>
        {p.sku && (
          <>
            <dt>SKU</dt>
            <dd className="ck-mono">{p.sku}</dd>
          </>
        )}
      </dl>
      <div className="ck-row">
        {p.moves.map((m) => (
          <button
            key={m.to}
            type="button"
            className={`btn${m.primary ? " btn--primary" : " btn--quiet"}`}
            disabled={status.busy}
            onClick={() => status.run(() => setShopProductStatus({ productId: p.id, status: m.to }))}
          >
            {m.label}
          </button>
        ))}
        <OutcomeLine outcome={status.outcome} />
      </div>

      <form
        style={{ display: "grid", gap: 10 }}
        onSubmit={(e) => {
          e.preventDefault()
          if (badPrice) return
          save.run(() => saveShopProduct({ productId: p.id, ...diff }))
        }}
      >
        <label className="ck-field">
          <span className="ck-mono">Name, line 1</span>
          <input className="ck-input" value={v.displayName1} onChange={set("displayName1")} maxLength={80} />
        </label>
        <label className="ck-field">
          <span className="ck-mono">Name, line 2</span>
          <input className="ck-input" value={v.displayName2} onChange={set("displayName2")} maxLength={80} />
        </label>
        <label className="ck-field">
          <span className="ck-mono">Small line above the name</span>
          <input className="ck-input" value={v.eyebrow} onChange={set("eyebrow")} maxLength={80} />
        </label>
        <div className="ck-row">
          <label className="ck-field" style={{ flex: 1 }}>
            <span className="ck-mono">Price, $</span>
            <input className={`ck-input${badPrice ? " ck-input--empty" : ""}`} inputMode="decimal" value={v.price} onChange={set("price")} />
          </label>
          <label className="ck-field" style={{ flex: 1 }}>
            <span className="ck-mono">Most per order</span>
            <input className="ck-input" inputMode="numeric" value={v.perOrderLimit} onChange={set("perOrderLimit")} />
          </label>
        </div>
        <label className="ck-field">
          <span className="ck-mono">Description</span>
          <textarea className="ck-input" value={v.description} onChange={set("description")} maxLength={4000} />
        </label>
        <div className="ck-row">
          <button type="submit" className="btn btn--primary" disabled={!dirty || badPrice || save.busy}>
            {save.busy ? "Saving…" : "Save"}
          </button>
          <OutcomeLine outcome={badPrice ? { ok: false, text: "Price is dollars and cents, like 32.00" } : save.outcome} />
        </div>
      </form>

      <div className="ck-row">
        {p.storeUrl && (
          <a className="btn btn--quiet" href={p.storeUrl} target="_blank" rel="noreferrer">
            See it on the shop
          </a>
        )}
        {p.editUrl && (
          <a className="btn btn--quiet" href={p.editUrl} target="_blank" rel="noreferrer">
            Photos and edition run
          </a>
        )}
      </div>
    </div>
  )
}
