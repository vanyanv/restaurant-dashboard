"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  DateControl,
  Note,
  PageHead,
  Queue,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
  type SwitchableStore,
  SubNav,
} from "@/components/counter"
import { VENDOR_TABS } from "@/lib/counter/nav"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { VendorsSections } from "@/lib/counter/adapters/vendors"

/**
 * Vendors, composed from `P.vendors.desk()` in the prototype's own order:
 *
 *   strip -> the vendor table -> a split of the price trend and the worklist.
 *
 * The adapter's docblock argues the departures. Two of the four strip cells
 * are about time this account does not record — `VendorLeadTime` is empty and
 * nothing in the schema carries a promised delivery date — and the table is
 * one row per VENDOR rather than per spelling, which is what makes Sysco
 * $155,430 instead of $104,038.
 */
export type CounterVendorsSections = SectionSources<VendorsSections>

const VENDOR_COLUMNS: Column[] = [
  { key: "vendor", label: "Vendor" },
  { key: "invoices", label: "Invoices", numeric: true },
  { key: "spend", label: "Spend", numeric: true },
  { key: "share", label: "Share", numeric: true },
  { key: "cadence", label: "Delivers" },
  { key: "trend", label: "Price trend", numeric: true },
  { key: "reconciles", label: "Reconciles" },
]

const ASK_SUGGESTIONS = [
  "Which vendor is getting more expensive?",
  "How much do I spend with each vendor?",
  "Which invoices do not reconcile?",
]

export function CounterVendorsClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterVendorsSections
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

  const { range, presetId, comparisonId } = counterParams
  const storeName = stores.find((s) => s.id === counterParams.storeId)?.name ?? "All stores"

  return (
    <>
      <PageHead title="Vendors" sub={`${storeName} · who you buy from and what they cost`}>
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

      {/* The design's `VIEWS` bar for this family — see `VENDOR_TABS` in
          `@/lib/counter/nav`. Without it these siblings are pages nothing
          links to; `.seg` is not a fidelity landmark, so it changes no count. */}
      <SubNav items={VENDOR_TABS} label="Vendors" />

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      <Section
        title="Vendors"
        meta={(t) => t.meta}
        data={sections.table}
        pending={pending}
        pad={false}
        askAbout="how much do I spend with each vendor"
      >
        {(t) => (
          <>
            <Table columns={VENDOR_COLUMNS} rows={t.rows} />
            {/* No `.sec__body` — a table section emits the table alone, so the
                note carries the body's own inset via `<Note flush>`. */}
            <Note flush>
              {t.note}
            </Note>
          </>
        )}
      </Section>

      <div className="split">
        <Section
          title="Price trend"
          meta={(t) => t.meta}
          data={sections.trend}
          pending={pending}
          askAbout="which vendor is getting more expensive"
        >
          {(t) => (
            <>
              <Chart {...t.chart} fmt={INDEX} />
              <Note>
                {t.note}
              </Note>
            </>
          )}
        </Section>

        <Section title="Worth a call" meta={(w) => w.meta} data={sections.work} pending={pending}>
          {(w) => <Queue items={w.items} />}
        </Section>
      </div>
    </>
  )
}

/**
 * The axis is percent change, not dollars — the adapter indexes every vendor
 * to its own first week, because Premier Meats bills by the pound and Vitco by
 * the case and they cannot share a dollar scale.
 */
const INDEX = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`
