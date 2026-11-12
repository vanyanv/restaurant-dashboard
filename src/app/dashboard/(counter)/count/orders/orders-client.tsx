"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Section, useCounterTransition, usePageChrome, useSurfaceHref } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { DraftData, DraftSections, DraftVendor, StockRow, StoreSummary } from "@/lib/counter/adapters/draft-orders"
import { setDraftSkipCount } from "@/lib/counter/actions/count"
import { COVER_DAY_CHOICES } from "@/lib/counter/draft-orders"
import { CountHead, money, OutcomeLine, type Outcome } from "../count-ui"

/**
 * Count & waste — Restock. Per store: what is on the shelf and how long it
 * lasts (Stock), and a draft of what to order from each vendor (Order), built
 * from the count, invoices and sales through recipes. On a phone the two are
 * one tap apart; on the desk they sit side by side. Every figure is an
 * estimate and says how it was reached. Nothing here places an order.
 */
export function OrdersClient({ sections }: { sections: SectionSources<DraftSections> }) {
  usePageChrome({ leaf: "Restock" })
  const { pending } = useCounterTransition()
  return (
    <>
      <CountHead sub="What each store has, and a draft of what to order. Estimates for testing; nothing is sent." />
      <Section title="Restock" meta={(d) => d?.store.name ?? ""} data={sections.drafts} pending={pending} pad={false}>
        {(d) => (d ? <Restock data={d} /> : null)}
      </Section>
    </>
  )
}

const PATH = "/dashboard/count/orders"
/** The days-left bar reads 0 to 14 days; anything longer fills it. */
const BAR_DAYS = 14

function Restock({ data }: { data: DraftData }) {
  const [view, setView] = useState<"order" | "stock">("order")
  const lines = data.vendors.reduce((t, v) => t + v.rows.length, 0)
  const dollars = data.vendors.reduce((t, v) => t + v.dollars, 0)
  const unpriced = data.vendors.reduce((t, v) => t + v.unpriced, 0)
  const urgent = data.vendors.reduce((t, v) => t + v.rows.filter((r) => r.urgent).length, 0)
  const needs = data.notCounted.length + data.belowZero.length

  return (
    <div className="rs">
      <StoreCards data={data} />

      <div className="cw-pad rs-lead">
        <p className="rs-lead__say">
          {lines === 0
            ? `${data.store.name} has enough of everything counted for ${data.coverDays} days after the next delivery.`
            : `${data.store.name} needs ${lines} ${lines === 1 ? "item" : "items"} from ${data.vendors.length} ${data.vendors.length === 1 ? "vendor" : "vendors"}${urgent > 0 ? `, ${urgent} to order today` : ""}.`}
        </p>
        {lines > 0 && (
          <div className="rs-lead__num">
            <span className="cw__mono">Draft order</span>
            <b>{unpriced === lines ? "No prices yet" : `about ${money(dollars)}`}</b>
            <small>
              At your latest invoice prices{unpriced > 0 && unpriced < lines ? `, ${unpriced} ${unpriced === 1 ? "item" : "items"} without a price not included` : ""}. Estimate: check it against what you would order.
            </small>
          </div>
        )}
        <div className="rs-seg" role="tablist" aria-label="Show">
          <button type="button" role="tab" aria-selected={view === "order"} onClick={() => setView("order")}>Order{lines > 0 ? ` · ${lines}` : ""}</button>
          <button type="button" role="tab" aria-selected={view === "stock"} onClick={() => setView("stock")}>Stock · {data.stock.length}</button>
        </div>
      </div>

      <div className="rs-split">
        <div className="rs-pane rs-pane--stock" data-on={view === "stock"}>
          <StockList rows={data.stock} />
        </div>
        <div className="rs-pane rs-pane--order" data-on={view === "order"}>
          <DraftPanel data={data} />
        </div>
      </div>

      {needs > 0 && (
        <details className="rs-fold">
          <summary>Needs you · {needs}</summary>
          <div className="cw-pad">
            {data.notCounted.length > 0 && (
              <p className="cw__sub">
                {data.store.skip ? "No count from before the last 7 days, so no draft" : `Not counted at ${data.store.name} yet, so no draft`}: {data.notCounted.join(", ")}.{" "}
                <CountLink storeId={data.store.id} />
              </p>
            )}
            {data.belowZero.length > 0 && (
              <p className="cw__sub">On hand reads below zero, so count these again before ordering: {data.belowZero.join(", ")}.</p>
            )}
          </div>
        </details>
      )}

      <SkipSwitch data={data} />
    </div>
  )
}

function CountLink({ storeId }: { storeId: string }) {
  const href = useSurfaceHref()
  return <Link href={href(`/dashboard/count?store=${storeId}`)}>Start a count</Link>
}

function StoreCards({ data }: { data: DraftData }) {
  const router = useRouter()
  const href = useSurfaceHref()
  const go = (s: StoreSummary) =>
    router.push(href(`${PATH}?${new URLSearchParams({ store: s.id, cover: String(data.coverDays) }).toString()}`))
  return (
    <div className="rs-stores" role="group" aria-label="Store">
      {data.summaries.map((s) => (
        <button key={s.id} type="button" className="rs-store" aria-pressed={s.id === data.store.id} onClick={() => go(s)}>
          <b>{s.name}</b>
          <span>
            {s.lines === 0 ? "Nothing to order" : `${s.lines} to order${s.unpriced < s.lines ? ` · about ${money(s.dollars)}` : ""}`}
          </span>
          {s.urgent > 0 && <small className="rs-store__now">{s.urgent} today</small>}
          {s.notCounted > 0 && <small>{s.notCounted} not counted</small>}
          {s.skip && <small>Skipping this week&apos;s count</small>}
        </button>
      ))}
    </div>
  )
}

function StockList({ rows }: { rows: StockRow[] }) {
  if (rows.length === 0) return <p className="cw__sub cw-pad">Nothing on the menu uses a counted item yet.</p>
  return (
    <div className="rs-stock">
      <div className="rs-srow rs-srow--head" aria-hidden>
        <span>Item</span><span>On hand</span><span>A day</span><span>Days left</span><span>Runs out</span><span>Status</span>
      </div>
      {rows.map((r) => (
        <div className="rs-srow" key={r.id}>
          <b className="rs-srow__name">{r.name}</b>
          <span className="rs-srow__fig" data-label="On hand">{r.onHand}</span>
          <span className="rs-srow__fig" data-label="A day">{r.perDay}</span>
          <span className="rs-srow__bar">
            <DaysBar row={r} />
          </span>
          <span className="rs-srow__out">
            {r.runsOut}
            <small className={r.stale ? "cd-item__stale" : undefined}>{r.counted}{r.stale ? ", rolled forward" : ""}</small>
          </span>
          <span className={`rs-pill rs-pill--${r.status}`}>{r.statusText}</span>
        </div>
      ))}
    </div>
  )
}

function DaysBar({ row }: { row: StockRow }) {
  if (row.daysLeft == null) return <span className="rs-bar rs-bar--none" />
  const fill = Math.min(1, row.daysLeft / BAR_DAYS) * 100
  const tick = row.orderAt != null ? Math.min(1, row.orderAt / BAR_DAYS) * 100 : null
  const label = row.daysLeft >= 60 ? "60+" : row.daysLeft < 1 ? "<1" : String(Math.floor(row.daysLeft))
  return (
    <span className="rs-bar" title={tick != null ? "The mark is when an order has to go in to arrive in time" : undefined}>
      <span className="rs-bar__track">
        <i className={`rs-bar__fill rs-bar__fill--${row.status}`} style={{ width: `${fill}%` }} />
        {tick != null && <i className="rs-bar__tick" style={{ left: `${tick}%` }} />}
      </span>
      <span className="rs-bar__n">{label} d</span>
    </span>
  )
}

function DraftPanel({ data }: { data: DraftData }) {
  const router = useRouter()
  const href = useSurfaceHref()
  return (
    <div className="rs-draft">
      <div className="cw-pad rs-draft__head">
        <div className="cw__chips" role="group" aria-label="Order enough to last">
          <span className="cw__mono" style={{ alignSelf: "center" }}>Last after it arrives</span>
          {COVER_DAY_CHOICES.map((n) => (
            <button
              key={n}
              type="button"
              className="cw__chip"
              aria-pressed={data.coverDays === n}
              onClick={() => router.push(href(`${PATH}?${new URLSearchParams({ store: data.store.id, cover: String(n) }).toString()}`))}
            >
              {n} days
            </button>
          ))}
        </div>
        {data.covered > 0 && <p className="cw__sub">{data.covered} counted {data.covered === 1 ? "item has" : "items have"} enough and {data.covered === 1 ? "is" : "are"} left off.</p>}
      </div>
      {data.vendors.length === 0 && <p className="cw__sub cw-pad">Nothing to order right now.</p>}
      {data.vendors.map((v) => (
        <VendorCard key={v.vendor} vendor={v} store={data.store.name} />
      ))}
    </div>
  )
}

function VendorCard({ vendor: v, store }: { vendor: DraftVendor; store: string }) {
  const [copied, setCopied] = useState<"" | "ok" | "bad">("")
  async function copy() {
    const text = [`${v.vendor} order for ${store}`, ...v.rows.map((r) => `- ${r.order} ${r.name}`)].join("\n")
    try {
      await navigator.clipboard.writeText(text)
      setCopied("ok")
    } catch {
      setCopied("bad")
    }
  }
  return (
    <div className="cd-vendor">
      <div className="cd-vendor__head">
        <h3>{v.vendor}</h3>
        <button type="button" className="cw__btn rs-copy" onClick={copy}>
          {copied === "ok" ? "Copied" : copied === "bad" ? "Couldn't copy" : "Copy order"}
        </button>
      </div>
      <span className="cw__mono">{v.lead} · {v.unpriced === v.rows.length ? "no prices yet" : `about ${money(v.dollars)}${v.unpriced > 0 ? `, ${v.unpriced} unpriced` : ""}`}</span>
      <div className="cd-list rs-list">
        {v.rows.map((r) => (
          <div className="cd-item" key={r.id}>
            <div className="cd-item__top">
              <b>{r.name}</b>
              <span className="cd-item__order">{r.order}</span>
            </div>
            <span className={`cd-item__when ${r.urgent ? "cd-item__when--now" : ""}`}>{r.when}</span>
            <span className="cd-item__facts">
              On hand {r.onHand} · uses about {r.perDay} a day ({r.basis})
              {r.caseNote ? ` · ${r.caseNote}` : ""}
              {r.dollars != null ? ` · about ${money(r.dollars)}` : " · no price yet"}
            </span>
            <span className={`cd-item__facts ${r.stale ? "cd-item__stale" : ""}`}>
              {r.counted}
              {r.stale ? ". A count was skipped, so on hand is rolled forward from then using invoices and sales, and may be further off." : ""}
            </span>
            {r.needCaseSize && <span className="cd-item__facts">No case size set, so this is in {r.unit}. Set it on the ingredient page.</span>}
            {r.partial && <span className="cd-item__facts">Some deliveries since the count need a case size, so on hand may read low.</span>}
            <details>
              <summary>How this was worked out</summary>
              <p>{r.how}</p>
            </details>
          </div>
        ))}
      </div>
    </div>
  )
}

function SkipSwitch({ data }: { data: DraftData }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [outcome, setOutcome] = useState<Outcome>(null)
  function toggle(skip: boolean) {
    start(async () => {
      const r = await setDraftSkipCount(data.store.id, skip)
      setOutcome(r.ok ? { ok: true, text: r.message ?? "Saved" } : { ok: false, text: r.error })
      router.refresh()
    })
  }
  return (
    <details className="rs-fold" open={data.store.skip}>
      <summary>Test: skip this week&apos;s count · {data.store.skip ? "On" : "Off"}</summary>
      <div className="cw-pad">
        <div className="cd-switch">
          <span>
            <b>Skip this week&apos;s count at {data.store.name}: {data.store.skip ? "On" : "Off"}</b>
            <br />
            <small style={{ color: "var(--ink-2)" }}>
              {data.store.skip
                ? "Counts from the last 7 days are left out. On hand is rolled forward from the count before."
                : "Using the latest count. Turn on to see what the order would be without it."}
            </small>
          </span>
          <button
            type="button"
            className={`cw__btn ${data.store.skip ? "cw__btn--primary" : ""}`}
            style={{ flex: "0 0 auto" }}
            disabled={busy}
            aria-pressed={data.store.skip}
            onClick={() => toggle(!data.store.skip)}
          >
            {data.store.skip ? "Turn off" : "Turn on"}
          </button>
        </div>
        <OutcomeLine outcome={outcome} />
      </div>
    </details>
  )
}
