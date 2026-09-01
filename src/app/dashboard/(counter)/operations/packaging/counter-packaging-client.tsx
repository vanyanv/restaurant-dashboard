"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  DateControl,
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
import type { PackagingSections } from "@/lib/counter/adapters/packaging"

/**
 * Packaging, composed from `P.packaging.desk()`:
 *
 *   strip -> the container ledger -> invoice validation.
 *
 * The adapter's docblock argues the numbers, and the short version is that the
 * packing model and the purchase record disagree on two of three containers —
 * one at 724% and one at 26%.
 *
 * `P.packaging`'s "Packaging per order" chart is dropped, and it is the one
 * thing on this page that is a capability gap rather than a choice:
 * `getPackagingCostData` packs every order in a RANGE and returns totals, not
 * a series. A per-day figure would mean running the packer once per day, which
 * is the whole model per point. See the manifest.
 *
 * "Which orders carry it" went the other way — a table this design does not
 * have, whose whole payload was one sentence about the per-order denominator.
 * It is the last line of the ledger's note now.
 */
export type CounterPackagingSections = SectionSources<PackagingSections>

const LEDGER_COLUMNS: Column[] = [
  { key: "container", label: "Container" },
  { key: "used", label: "Used", numeric: true },
  { key: "bought", label: "Bought", numeric: true },
  { key: "unit", label: "Unit cost", numeric: true },
  { key: "spend", label: "Spend", numeric: true },
  { key: "utilisation", label: "Utilisation", numeric: true },
]

const ASK_SUGGESTIONS = [
  "What does packaging cost per order?",
  "Which containers do the invoices disagree with?",
  "How much of COGS is packaging?",
]

export function CounterPackagingClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterPackagingSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  usePageChrome({ leaf: "Packaging", askSuggestions: ASK_SUGGESTIONS })

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
      <PageHead
        title="Packaging"
        sub={`${storeName} · the cost that rides along with every order`}
      >
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
        title="Container ledger"
        meta={(l) => l.meta}
        data={sections.ledger}
        pending={pending}
        pad={false}
        askAbout="which containers do the invoices disagree with"
      >
        {(l) => (
          <>
            <Table columns={LEDGER_COLUMNS} rows={l.rows} />
            {/* No `.sec__body` — a table section emits the table alone. */}
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {l.note}
            </p>
          </>
        )}
      </Section>

      {/* No `.split` — `P.packaging` pairs this queue with its per-order
          chart, and with the chart absent a two-column grid holding one panel
          is furniture. See the docblock. */}
      <Section
        title="Invoice validation"
        meta={(w) => w.meta}
        data={sections.work}
        pending={pending}
      >
        {(w) => <Queue items={w.items} />}
      </Section>
    </>
  )
}
