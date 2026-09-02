"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
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
} from "@/components/counter"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { OperationsSections } from "@/lib/counter/adapters/operations"

/**
 * Operations, composed from `P.operations.desk()`:
 *
 *   strip -> a split of the cross-area worklist and the areas table.
 *
 * The adapter's docblock argues the departures. Two of the four strip cells
 * need a stock count that finished, and this account has four counts of which
 * none was ever completed — so `On-hand value` and `Theoretical vs actual`
 * have no source, and what replaces them is the reason: how many areas are
 * still being touched, and how many counts were started and left.
 */
export type CounterOperationsSections = SectionSources<OperationsSections>

const AREA_COLUMNS: Column[] = [
  { key: "area", label: "Area" },
  { key: "open", label: "Open", numeric: true },
  { key: "what", label: "What" },
  { key: "worth", label: "Worth", numeric: true },
  { key: "touched", label: "Last touched" },
]

const ASK_SUGGESTIONS = [
  "What is open across operations?",
  "Which areas have stopped being used?",
  "Why is there no on-hand value?",
]

export function CounterOperationsClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterOperationsSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  // `/dashboard/operations` is not a rail destination, so the breadcrumb has
  // no label to fall back on and rendered as "All stores /" with nothing after
  // it. A hub names itself.
  usePageChrome({ leaf: "Operations", askSuggestions: ASK_SUGGESTIONS })

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
      <PageHead title="Operations" sub={`${storeName} · what is open and what each area is worth`}>
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

      <div className="split">
        <Section
          title="Needs you across operations"
          meta={(w) => w.meta}
          data={sections.work}
          pending={pending}
          askAbout="what is open across operations"
        >
          {(w) => <Queue items={w.items} />}
        </Section>

        <Section
          title="The areas"
          meta={(a) => a.meta}
          data={sections.areas}
          pending={pending}
          pad={false}
          askAbout="which areas have stopped being used"
        >
          {(a) => (
            <>
              <Table columns={AREA_COLUMNS} rows={a.rows} />
              {/* No `.sec__body` — a table section emits the table alone, so
                  the note carries the body's own inset via `<Note flush>`. */}
              <Note flush>
                {a.note}
              </Note>
            </>
          )}
        </Section>
      </div>
    </>
  )
}
