"use client"

import Link from "next/link"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  DateControl,
  Kv,
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
import type { StockCountsSections } from "@/lib/counter/adapters/stock-counts"

/**
 * Stock counts, composed from `P.counts.desk()`:
 *
 *   strip -> the sessions -> variance.
 *
 * The adapter's docblock argues the departures, and they are large: the
 * prototype's `Shrink` cell, its `Short`/`Over`/`$ variance` columns and its
 * variance-by-session chart all subtract a counted quantity from an expected
 * one that this account has never recorded. The section that replaces the
 * chart says what it would need rather than drawing an invented series.
 */
export type CounterCountsSections = SectionSources<StockCountsSections>

const SESSION_COLUMNS: Column[] = [
  { key: "counted", label: "Counted" },
  { key: "store", label: "Store" },
  { key: "by", label: "By" },
  { key: "lines", label: "Lines", numeric: true },
  { key: "value", label: "Counted stock", numeric: true },
  { key: "status", label: "Status" },
]

const ASK_SUGGESTIONS = [
  "When was the last stock count?",
  "Why is there no shrink figure?",
  "What was counted and what is it worth?",
]

export function CounterCountsClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterCountsSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  usePageChrome({ leaf: "Stock counts", askSuggestions: ASK_SUGGESTIONS })

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
      <PageHead title="Stock counts" sub={`${storeName} · every session and what it found`}>
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

      <Section
        title="Sessions"
        meta={(s) => s.meta}
        data={sections.sessions}
        pending={pending}
        pad={false}
        askAbout="when was the last stock count"
      >
        {(s) => (
          <>
            <Table columns={SESSION_COLUMNS} rows={s.rows} />
            {/* No `.sec__body` — a table section emits the table alone. */}
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {s.note}
            </p>
          </>
        )}
      </Section>

      <Section
        title="Variance"
        meta={(v) => v.meta}
        data={sections.variance}
        pending={pending}
        askAbout="why is there no shrink figure"
      >
        {(v) => (
          <>
            <p className="ans__lead" style={{ margin: "0 0 14px" }}>
              {v.lead}
            </p>
            <Kv rows={v.rows} />
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {v.note}
            </p>
          </>
        )}
      </Section>
      {/* `P.counts`' "The count in progress". The prototype puts it beside the
          variance chart; ours states who, when and how far — the three things
          the schema records — and links to the session. */}
      <Section
        title="The count in progress"
        meta={(p) => p.meta}
        data={sections.progress}
        pending={pending}
      >
        {(p) => (
          <>
            <p style={{ margin: "0 0 12px", fontSize: "var(--ct-t-mid)", lineHeight: 1.5 }}>
              {p.lead}
            </p>
            {p.href ? (
              <div className="btnrow">
                <Link className="btn btn--primary" href={p.href}>
                  Open the count
                </Link>
              </div>
            ) : null}
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {p.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
