"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  DateControl,
  Note,
  PageHead,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
  type SwitchableStore,
} from "@/components/counter"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { VendorSections } from "@/lib/counter/adapters/vendor"

/**
 * One vendor, composed from `P.vendor.desk()`:
 *
 *   strip -> spend by week -> a split of the invoices and the basket.
 *
 * The adapter's docblock argues the departures: no lead time exists to report,
 * and the basket is compared against whichever vendor is cheapest rather than
 * the one rival the prototype names.
 */
export type CounterVendorSections = SectionSources<VendorSections>

const INVOICE_COLUMNS: Column[] = [
  { key: "invoice", label: "Invoice" },
  { key: "date", label: "Delivered" },
  { key: "total", label: "Total", numeric: true },
  { key: "lines", label: "Lines", numeric: true },
  { key: "reconciles", label: "Reconciles", numeric: true },
  { key: "status", label: "Status" },
]

const BASKET_COLUMNS: Column[] = [
  { key: "item", label: "Item" },
  { key: "mine", label: "Here", numeric: true },
  { key: "best", label: "Cheapest", numeric: true },
  { key: "who", label: "From" },
  { key: "gap", label: "Difference", numeric: true },
]

const ASK_SUGGESTIONS = [
  "What do I buy from this vendor?",
  "Is anything cheaper somewhere else?",
  "Which of their invoices do not reconcile?",
]

export function CounterVendorClient({
  params: paramsString,
  stores,
  today,
  title,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  title: string
  sections: CounterVendorSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  usePageChrome({ leaf: title, askSuggestions: ASK_SUGGESTIONS })

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
      <PageHead title={title} sub={storeName}>
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

      <Section bare title="The figures" data={sections.head} pending={pending}>
        {(h) => (
          <>
            <Note lede>
              {h.sub}
            </Note>
            <Strip cells={h.cells} />
          </>
        )}
      </Section>

      <Section title="Spend" meta={(s) => s.meta} data={sections.spend} pending={pending}>
        {(s) => (
          <>
            <Chart {...s.chart} fmt={USD} />
            <Note>
              {s.note}
            </Note>
          </>
        )}
      </Section>

      <div className="split">
        <Section
          title="Invoices"
          meta={(i) => i.meta}
          data={sections.invoices}
          pending={pending}
          pad={false}
        >
          {(i) => (
            <>
              <Table columns={INVOICE_COLUMNS} rows={i.rows} />
              {/* No `.sec__body` — a table section emits the table alone. */}
              <Note flush>
                {i.note}
              </Note>
            </>
          )}
        </Section>

        <Section
          title="The basket"
          meta={(b) => b.meta}
          data={sections.basket}
          pending={pending}
          pad={false}
          askAbout="is anything cheaper somewhere else"
        >
          {(b) => (
            <>
              <Table columns={BASKET_COLUMNS} rows={b.rows} />
              <Note flush>
                {b.note}
              </Note>
            </>
          )}
        </Section>
      </div>
    </>
  )
}

/** Whole dollars — a weekly spend bar, not a unit price. */
const USD = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`
