"use client"

import Link from "next/link"
import {
  Section,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
} from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { DeskItem, InvoiceDesk, InvoicesSections } from "@/lib/counter/adapters/invoices"
import type { PriceSections } from "@/lib/counter/adapters/prices"
import { InvoiceGlyph, InvoiceLegend, InvoicesHead, Tiles } from "./invoices-ui"

/**
 * Invoices — Needs you. The desk in one screen, the way Shop's Today is: the
 * counts, a red line when something does not add up, then every invoice that
 * needs the owner with its one next step, biggest money first. What the
 * prices did sits underneath, ranked by dollars, because a price move is a
 * glance and the queue is a job.
 *
 * Every figure is the adapter's: the tiles are `headline.cells`, the queue is
 * `desk.items` (the same worklist `review` cuts to three for the phone), and
 * the price box is the Price monitor's own `movers`.
 */
export type CounterInvoicesSections = SectionSources<Pick<InvoicesSections, "headline" | "desk">>
export type InvoicePriceSections = SectionSources<Pick<PriceSections, "movers">>

const ASK_SUGGESTIONS = [
  "Which invoices do not reconcile, and by how much?",
  "What did I spend the most on this month?",
  "Which ingredient prices moved against last period?",
]

/** Where each strip tile goes when tapped, in `headlineOf`'s order. */
const TILE_HREFS = [
  "/dashboard/invoices/all",
  "/dashboard/invoices/all?view=matched",
  "/dashboard/invoices/all?view=review",
  "/dashboard/invoices/all?view=gaps",
  null,
]

const PRICE_COLUMNS: Column[] = [
  { key: "ingredient", label: "Ingredient" },
  { key: "move", label: "Move", numeric: true },
  { key: "costs", label: "Costs you, 30d", numeric: true },
]

const PRICE_ROWS = 5

export function CounterInvoicesClient({
  sub,
  sections,
  prices,
}: {
  sub: string
  sections: CounterInvoicesSections
  prices: InvoicePriceSections
}) {
  usePageChrome({ leaf: "Invoices", askSuggestions: ASK_SUGGESTIONS })
  const { pending } = useCounterTransition()

  return (
    <>
      <InvoicesHead sub={sub} />

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Tiles cells={h.cells} hrefs={TILE_HREFS} />}
      </Section>

      <Section bare title="Does not add up" data={sections.desk} pending={pending}>
        {(d) => <Alert desk={d} />}
      </Section>

      <Section
        title="To review"
        meta={(d) => d.meta}
        data={sections.desk}
        pending={pending}
        pad={false}
        askAbout="which invoices do not reconcile"
      >
        {(d) => <Queue items={d.items} />}
      </Section>

      <Section
        title="Prices that moved"
        meta={() => "all stores · ranked by dollars, not percent"}
        data={prices.movers}
        pending={pending}
        pad={false}
        askAbout="which ingredient prices moved"
      >
        {(m) => (
          <>
            <Table columns={PRICE_COLUMNS} rows={m.rows.slice(0, PRICE_ROWS)} />
            <p className="sh-empty">
              <Link href="/dashboard/invoices/prices">Every price that moved</Link>
            </p>
          </>
        )}
      </Section>

      <div style={{ padding: "4px 2px" }}>
        <InvoiceLegend />
      </div>
    </>
  )
}

function Alert({ desk }: { desk: InvoiceDesk }) {
  if (desk.broken === 0) return null
  return (
    <div className="ck-alerts">
      <div className="ck-alert">
        <InvoiceGlyph kind="miss" />
        <span>
          <b>
            {desk.broken === 1 ? "1 invoice does not add up" : `${desk.broken} invoices do not add up`}
            {desk.brokenNet ? `: ${desk.brokenNet} in all.` : "."}
          </b>{" "}
          <span className="ck-meta">Approve stays locked on each until its lines match what it prints.</span>
        </span>
        <Link className="btn" href="/dashboard/invoices/all?view=gaps">
          Show them
        </Link>
      </div>
    </div>
  )
}

function Queue({ items }: { items: DeskItem[] }) {
  if (items.length === 0) {
    return <p className="sh-empty">Nothing needs you. Every invoice ties out and none is held for review.</p>
  }
  return (
    <div className="sh-queue">
      {items.map((it) => (
        <div className="sh-order" key={it.key}>
          <InvoiceGlyph kind={it.glyph} />
          <Link href={it.href} className="who" style={{ color: "inherit", textDecoration: "none" }}>
            <b>
              {it.vendor} · {it.number}
            </b>
            <span className="ck-mono">{it.where}</span>
          </Link>
          <span className="what">
            <b>{it.reason}</b> {it.detail}
          </span>
          <span className="amt">{it.total}</span>
          <span className="act">
            <Link className="btn btn--primary" href={it.href}>
              {it.act}
            </Link>
          </span>
        </div>
      ))}
    </div>
  )
}
