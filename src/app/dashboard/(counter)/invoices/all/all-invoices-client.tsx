"use client"

import { useCallback, useDeferredValue, useMemo, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  DateControl,
  Filters,
  Note,
  Section,
  Table,
  Tag,
  useCounterTransition,
  usePageChrome,
  useSurfaceHref,
  type Column,
  type Row,
  type SwitchableStore,
} from "@/components/counter"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { rangeLabel, stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { InvoiceList, InvoicesSections, ProductRow } from "@/lib/counter/adapters/invoices"
import { InvoiceGlyph, InvoiceLegend, InvoicesHead } from "../invoices-ui"
import { VIEWS, VIEW_LABEL, inView, type View } from "./views"

/**
 * Invoices — All invoices. One list with a chip per view and a search box,
 * every row wearing the same status shape the queue does, then the spend and
 * what it was on for the range the date control picks.
 *
 * The list is the adapter's `list.rows`: the trailing 30 days plus every
 * older invoice still on the worklist (`inWindow: false`), which only the
 * worklist views show. See `views.ts`.
 */
type Sections = SectionSources<Pick<InvoicesSections, "list" | "spend" | "products" | "documents">>

const LIST_COLUMNS: Column[] = [
  { key: "invoice", label: "Invoice" },
  { key: "store", label: "Store" },
  { key: "date", label: "Billed" },
  // The date the VENDOR printed. Nothing here records a payment; the note
  // under the table says so, and the tag marks the date, not a debt.
  { key: "due", label: "Due" },
  { key: "lines", label: "Lines" },
  { key: "total", label: "Total", numeric: true },
  { key: "ties", label: "Ties out", numeric: true },
]

const PRODUCT_COLUMNS: Column[] = [
  { key: "product", label: "Product" },
  { key: "vendor", label: "Vendor" },
  { key: "qty", label: "Qty", numeric: true },
  { key: "spend", label: "Spend", numeric: true },
  { key: "price", label: "Unit price" },
  { key: "moved", label: "Moved" },
]

const HOLD_COLUMNS: Column[] = [
  { key: "held", label: "Held" },
  { key: "n", label: "Count", numeric: true },
  { key: "do", label: "What you can do" },
]

/** Rows drawn before the list stops. The count line says what was left out. */
const MAX_ROWS = 60

export function AllInvoicesClient({
  params: paramsString,
  stores,
  today,
  initialView,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  initialView: View
  sections: Sections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  usePageChrome({
    leaf: "All invoices",
    askSuggestions: ["Which invoices do not reconcile, and by how much?", "What did I spend the most on this month?"],
  })
  const { pending, startTransition } = useCounterTransition()

  const push = useCallback(
    (next: Parameters<typeof writeCounterParams>[1]) => {
      const qs = writeCounterParams(params, next).toString()
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      })
    },
    [params, pathname, router, startTransition],
  )

  const { range, presetId, comparisonId } = counterParams
  const storeName = stores.find((s) => s.id === counterParams.storeId)?.name ?? "All stores"

  return (
    <>
      <InvoicesHead sub={`${storeName} · last 30 days, plus anything still open`}>
        <DateControl
          presetId={presetId}
          comparisonId={comparisonId}
          range={range}
          onPreset={(id) => push({ presetId: id })}
          onComparison={(id) => push({ comparisonId: id })}
          onStep={(direction) => push({ range: stepRange(range, direction) })}
          onRange={(next) => push({ range: next })}
        />
      </InvoicesHead>

      <Section title="Invoices" meta={(l) => l.windowLabel} data={sections.list} pending={pending} pad={false}>
        {(l) => <InvoiceTable list={l} initialView={initialView} />}
      </Section>

      <div style={{ padding: "4px 2px" }}>
        <InvoiceLegend />
      </div>

      <Section
        title="Spend"
        meta={() => `${rangeLabel(range, "custom")} · the date control sets this`}
        data={sections.spend}
        pending={pending}
        askAbout="what the invoice spend was"
      >
        {(s) => (
          <>
            <Chart {...s.chart} />
            <Note>{s.note}</Note>
          </>
        )}
      </Section>

      <Section
        title="What the spend was on"
        meta={(p) => p.meta}
        data={sections.products}
        pending={pending}
        pad={false}
        askAbout="what the invoice spend was actually on"
      >
        {(p) => (
          <>
            <Table columns={PRODUCT_COLUMNS} rows={p.rows.map(productRow)} />
            <Note flush>{p.note}</Note>
          </>
        )}
      </Section>

      <Section title="The files" meta={(d) => d.meta} data={sections.documents} pending={pending} pad={false}>
        {(d) => (
          <>
            <Table columns={HOLD_COLUMNS} rows={d.rows} />
            <Note flush>{d.lead}</Note>
          </>
        )}
      </Section>
    </>
  )
}

function InvoiceTable({ list, initialView }: { list: InvoiceList; initialView: View }) {
  const surface = useSurfaceHref()
  const [view, setView] = useState<View>(initialView)
  const [search, setSearch] = useState("")
  const query = useDeferredValue(search)
  const needle = query.trim().toLowerCase()

  const counts = useMemo(() => {
    const c = {} as Record<View, number>
    for (const v of VIEWS) c[v] = list.rows.filter((r) => inView(r, v)).length
    return c
  }, [list.rows])

  const matched = useMemo(
    () => list.rows.filter((r) => inView(r, view) && (needle === "" || r.search.includes(needle))),
    [list.rows, view, needle],
  )
  const shown = matched.slice(0, MAX_ROWS)

  const rows: Row[] = shown.map((r) => ({
    key: r.id,
    href: surface(`/dashboard/invoices/${r.id}`),
    cells: {
      invoice: {
        v: (
          <span className="iv-inv">
            <InvoiceGlyph kind={r.glyph} />
            <span>
              <b>{r.vendor}</b>
              <span className="ck-mono">
                {r.number}
                {r.isReturn ? " · credit" : ""}
              </span>
            </span>
          </span>
        ),
      },
      store: r.store ?? "—",
      date: r.date,
      due: r.dueTone ? { v: <Tag tone={r.dueTone}>{r.due}</Tag> } : r.due,
      lines: r.hasPdf ? r.lineLabel : { v: <span className="ck-meta">no file</span> },
      total: { v: <b>{r.total}</b> },
      ties: r.gap ? { v: <span className="iv-gap">{r.gap}</span> } : { v: <span className="iv-ok">✓</span> },
    },
  }))

  return (
    <>
      <Filters
        search={search}
        searchPlaceholder="Invoice number, vendor, store or item"
        searchLabel="Search invoices"
        onSearch={setSearch}
        toggles={VIEWS.map((v) => ({
          id: v,
          label: VIEW_LABEL[v],
          count: counts[v],
          pressed: view === v,
          disabled: v !== "all" && counts[v] === 0,
        }))}
        onToggle={(id) => setView(id as View)}
        onClear={search || view !== "all" ? () => { setSearch(""); setView("all") } : undefined}
        count={
          shown.length === matched.length
            ? `${matched.length} shown`
            : `${shown.length} of ${matched.length} shown`
        }
      />
      {rows.length === 0 ? (
        <p className="sh-empty">No invoice matches. Clear the search or pick another view.</p>
      ) : (
        <Table columns={LIST_COLUMNS} rows={rows} />
      )}
      <Note flush>{list.dueNote}</Note>
    </>
  )
}

function productRow(p: ProductRow): Row {
  return {
    key: p.key,
    cells: {
      product: p.name,
      vendor: p.vendor,
      qty: p.qty,
      spend: p.spend,
      price: p.price,
      moved: { v: <Tag tone={p.movedTone ?? undefined}>{p.moved}</Tag> },
    },
  }
}
