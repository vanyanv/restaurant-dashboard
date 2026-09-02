"use client"

import { useCallback, useDeferredValue, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  DateControl,
  Filters,
  Lede,
  MoneyLines,
  Note,
  PageHead,
  Queue,
  Section,
  Strip,
  Table,
  Tag,
  useCounterTransition,
  usePageChrome,
  type Column,
  type FilterToggle,
  type Row,
  type SwitchableStore,
} from "@/components/counter"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { rangeLabel, stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
  InvoiceList,
  InvoiceStatusId,
  InvoicesSections,
  ProductRow,
} from "@/lib/counter/adapters/invoices"

/**
 * Invoices, composed from `P.invoices.desk()`
 * (`docs/counter/counter-prototype.html:5621`) in the prototype's own order:
 *
 *   strip → a headless `.sec` of filters and the list → spend → the split of
 *   what we hold and what to fix → what the spend was on.
 *
 * ## Two sections keep their shape and change their subject
 *
 * **"What we hold"** was written for an account where three invoices predated
 * object storage. Every one of these 226 has its file, so the section asks the
 * next question instead: of the documents we hold, which have actually been
 * read into lines. One has not.
 *
 * **"Fix before approving"** is not the `status = REVIEW` list. The two
 * largest errors in the account — a return extracted twice and an invoice with
 * no lines at all — are both `MATCHED`, which is to say no rule ever flagged
 * them. The queue is ordered by what the mistake is worth.
 *
 * Both are argued in `docs/counter/measurements/2026-08-28-invoices.md`.
 */
export type CounterInvoicesSections = SectionSources<InvoicesSections>

const LIST_COLUMNS: Column[] = [
  { key: "invoice", label: "Invoice" },
  { key: "vendor", label: "Vendor" },
  { key: "date", label: "Date" },
  { key: "total", label: "Total", numeric: true },
  { key: "document", label: "Document" },
  { key: "reconciles", label: "Reconciles" },
  { key: "status", label: "Status" },
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

const ASK_SUGGESTIONS = [
  "Which invoices do not reconcile, and by how much?",
  "What did I spend the most on this month?",
  "Which ingredient prices moved against last period?",
]

/** Rows drawn before the list stops. The count line says what was left out. */
const MAX_ROWS = 40

export function CounterInvoicesClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterInvoicesSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  usePageChrome({ askSuggestions: ASK_SUGGESTIONS })

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

  const [search, setSearch] = useState("")
  const [hidden, setHidden] = useState<ReadonlySet<InvoiceStatusId>>(new Set())
  /** Scoped to what does not tie out, across every date. See `InvoiceRows`. */
  const [onlyGaps, setOnlyGaps] = useState(false)
  const query = useDeferredValue(search)

  const { range, presetId, comparisonId } = counterParams
  const storeName =
    stores.find((s) => s.id === counterParams.storeId)?.name ?? "All stores"
  const windowLabel = rangeLabel(range, "custom")

  return (
    <>
      <PageHead title="Invoices" sub={`${storeName} · ${windowLabel}`}>
        <DateControl
          presetId={presetId}
          comparisonId={comparisonId}
          range={range}
          onPreset={(id) => push({ presetId: id })}
          onComparison={(id) => push({ comparisonId: id })}
          onStep={(direction) => push({ range: stepRange(range, direction) })}
          onRange={(next) => push({ range: next })}
        />
      </PageHead>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      {/* The prototype's own headless `.sec` — filters and table, no head. */}
      <div className="sec">
        <Section bare title="Received" data={sections.list} pending={pending}>
          {(l) => (
            <InvoiceTable
              list={l}
              search={search}
              query={query}
              onSearch={setSearch}
              hidden={hidden}
              onlyGaps={onlyGaps}
              onOnlyGaps={setOnlyGaps}
              onToggle={(id) =>
                setHidden((prev) => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }
              onClear={
                search || hidden.size > 0
                  ? () => {
                      setSearch("")
                      setHidden(new Set())
                    }
                  : undefined
              }
            />
          )}
        </Section>
      </div>

      <Section
        title="Spend"
        meta={(s) => s.meta}
        data={sections.spend}
        pending={pending}
        askAbout="what the invoice spend was"
      >
        {(s) => (
          <>
            <Chart {...s.chart} />
            <Note>
              {s.note}
            </Note>
          </>
        )}
      </Section>

      <div className="split">
        <Section title="What we hold" meta={(d) => d.meta} data={sections.documents} pending={pending}>
          {(d) => (
            <>
              <Lede>
                {d.lead}
              </Lede>
              <Table columns={HOLD_COLUMNS} rows={d.rows} />
              <div className="btnrow" style={{ marginTop: 12 }}>
                {d.actions.map((a) => (
                  <Link key={a.href} className={a.primary ? "btn btn--primary" : "btn"} href={a.href}>
                    {a.label}
                  </Link>
                ))}
              </div>
            </>
          )}
        </Section>

        <Section
          title="Fix before approving"
          meta={(r) => r.meta}
          data={sections.review}
          pending={pending}
          askAbout="which invoices do not reconcile"
        >
          {(r) => (
            <>
              <Queue items={r.items} />
              <div style={{ marginTop: 14 }}>
                <MoneyLines rows={r.money} />
              </div>
              <Note>
                {r.note}
              </Note>
            </>
          )}
        </Section>
      </div>

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
            {/* No `.sec__body` — `sec(..., tbl(...))` emits the table alone,
                so the note carries the body's own inset via `<Note flush>`. */}
            <Note flush>
              {p.note}
            </Note>
          </>
        )}
      </Section>
    </>
  )
}

/**
 * The list, its filters, and the count of what survived them.
 *
 * `.held`, `.lineflag` and `.statuspill` all carry rules in the generated
 * sheet (`src/styles/counter-components.css:260`, `:320`, `:335`) and NOTHING
 * in this tree rendered any of them until this file — the same situation
 * `.mdot` and `.rankbar` were in. `StatusPill` is not reused: it maps ALERT
 * severities onto these three class names, and this is the pill they were
 * named for.
 */
function InvoiceTable({
  list,
  search,
  query,
  onSearch,
  hidden,
  onToggle,
  onlyGaps,
  onOnlyGaps,
  onClear,
}: {
  list: InvoiceList
  search: string
  query: string
  onSearch: (next: string) => void
  hidden: ReadonlySet<InvoiceStatusId>
  onToggle: (id: InvoiceStatusId) => void
  /** Whether the list is scoped to what does not reconcile. See `matched`. */
  onlyGaps: boolean
  onOnlyGaps: (next: boolean) => void
  onClear?: () => void
}) {
  const needle = query.trim().toLowerCase()

  /*
   * TWO AXES, NOT ONE.
   *
   * The three status chips answer "how are the last thirty days made up".
   * "Does not reconcile" answers something else — it is the strip's own
   * figure, counted over EVERY invoice on the account, and until it existed
   * the page named seven broken invoices worth $3,974 and offered no way to
   * open one. So it is its own piece of state rather than a fourth member of
   * `hidden`: pressing it is not hiding a status, it is changing which
   * invoices the page is about.
   *
   * Off, the list is what it says it is — the window. On, it is every
   * non-reconciling invoice whatever its date, which is the only view in which
   * the strip's figure and the rows agree.
   */
  const matched = useMemo(
    () =>
      list.rows.filter(
        (r) =>
          (onlyGaps ? r.gap !== null : r.inWindow) &&
          !hidden.has(r.status) &&
          (needle === "" || r.search.includes(needle)),
      ),
    [list.rows, hidden, needle, onlyGaps],
  )

  const toggles: FilterToggle[] = [
    ...list.statuses.map((s) => ({
      id: s.id,
      label: s.label,
      count: s.count,
      pressed: !hidden.has(s.id),
      disabled: s.count === 0,
    })),
    {
      id: GAP_FILTER,
      label: "Does not reconcile",
      count: list.gapCount,
      pressed: onlyGaps,
      disabled: list.gapCount === 0,
    },
  ]

  const shown = matched.slice(0, MAX_ROWS)

  const rows: Row[] = shown.map((r) => ({
    key: r.id,
    href: `/dashboard/invoices/${r.id}`,
    cells: {
      invoice: { v: <b>{r.number}</b> },
      vendor: r.vendor,
      date: r.date,
      total: r.total,
      document: r.hasPdf
        ? { v: <span className="held">{r.lineLabel}</span> }
        : { v: <span className="held is-none">not stored</span> },
      reconciles: r.gap
        ? { v: <span className="lineflag">{r.gap}</span> }
        : { v: "✓" },
      status: { v: <span className={`statuspill ${r.status}`}>{STATUS_WORD[r.status]}</span> },
    },
  }))

  return (
    <>
      <Filters
        search={search}
        searchPlaceholder="Invoice, vendor, item"
        searchLabel="Search invoices"
        onSearch={onSearch}
        toggles={toggles}
        onToggle={(id) =>
          id === GAP_FILTER ? onOnlyGaps(!onlyGaps) : onToggle(id as InvoiceStatusId)
        }
        onClear={onClear}
        count={
          shown.length === matched.length
            ? `${matched.length} of ${onlyGaps ? list.gapCount : list.rows.filter((r) => r.inWindow).length}`
            : `${shown.length} of ${matched.length} shown`
        }
      />
      <Table columns={LIST_COLUMNS} rows={rows} />
    </>
  )
}

/** The pill's word. Its CLASS is the status; its label is a word, not a shout. */
/**
 * The reconcile chip's id. A literal that cannot collide with an
 * `InvoiceStatusId`, because it is not one — see `matched`.
 */
const GAP_FILTER = "GAP"

const STATUS_WORD: Record<InvoiceStatusId, string> = {
  REVIEW: "Review",
  APPROVED: "Approved",
  MATCHED: "Matched",
}

/**
 * The price-move cell wears the prototype's own two marks — `.mtag warn` for a
 * rise, `.mtag good` for a fall. It is an INGREDIENT cost, so the fall is the
 * good one, and `Tag` already owns that mapping. The adapter names the tone
 * and never the class.
 */
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
