"use client"

import { useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  AppShell,
  EntryItem,
  Topbar,
  StoreSwitcher,
  DateControl,
  Section,
  Strip,
  Table,
  type SwitchableStore,
} from "@/components/counter"
import { readCounterParams, writeCounterParams, type CounterParams } from "@/lib/counter/url-state"
import { PRESETS } from "@/lib/counter/date-range"
import { money, pct, delta } from "@/lib/counter/format"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * What `page.tsx` hands this island — already shaped exactly the way each
 * primitive below renders it. `src/lib/counter/adapters/overview.ts` is
 * where that shaping happens; this file never inspects `.status` (the six
 * renderings all live inside `Section`) and never formats a number a second
 * way.
 *
 * `sales` and `splh` are two sections, not one. Note 30: net sales says
 * whether the day happened, sales per labour hour says whether it was worth
 * having — but SPLH's real data source (`getSplhSeries`) cannot be scoped to
 * Counter's selected range at all, so it is unconditionally `not_computed`
 * (R1, Plan 7) while net sales stays `ready`. One `SectionData` can only
 * carry one status, so the two numbers this page leads with cannot share a
 * section.
 */
export interface OverviewClientSections {
  sales: SectionData<{ netSales: number }>
  splh: SectionData<null>
  ledger: SectionData<
    Array<{
      storeId: string
      store: string
      net: number
      cogsPct: number | null
      deltaVsTargetPp: number | null
    }>
  >
  invoices: SectionData<{ spend: number; count: number; needsReview: number }>
  needsYou: SectionData<null>
  modelCall: SectionData<null>
}

export function CounterOverviewClient({
  pathname,
  params,
  stores,
  today,
  sections,
}: {
  pathname: string
  /** The URL Overview was rendered for. Read for the controls' state AND
   *  passed straight into `AppShell` so the Ask surface's context sentence
   *  can never name a different range or store than what's on screen. */
  params: URLSearchParams
  stores: SwitchableStore[]
  today: Date
  sections: OverviewClientSections
}) {
  const router = useRouter()
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  const push = useCallback(
    (next: Partial<Pick<CounterParams, "presetId" | "comparisonId" | "storeId">>) => {
      const nextParams = writeCounterParams(params, next)
      const qs = nextParams.toString()
      // push, not replace: note 19's "a range that only changes the label is
      // a lie" cuts the other way too — a range change is a real navigation
      // an owner expects the back button to undo.
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [params, pathname, router],
  )

  const selectedStore = stores.find((s) => s.id === counterParams.storeId) ?? null

  return (
    <AppShell
      pathname={pathname}
      params={params}
      storeName={selectedStore?.name ?? null}
      today={today}
      topbar={
        <Topbar pathname={pathname} title="Overview">
          <StoreSwitcher
            stores={stores}
            selectedId={counterParams.storeId}
            onSelect={(id) => push({ storeId: id })}
          />
          <DateControl
            presetId={counterParams.presetId}
            comparisonId={counterParams.comparisonId}
            range={counterParams.range}
            onPreset={(id) => push({ presetId: id })}
            onComparison={(id) => push({ comparisonId: id })}
            // Known gap: url-state.ts's CounterParams only stores a NAMED
            // preset, not an arbitrary start/end — every preset resolves
            // against `today`, so there is no way to express "one period
            // back" as a preset id. Stepping needs a raw custom-range param
            // this plan does not add. Left inert rather than faked.
            onStep={() => {}}
          />
        </Topbar>
      }
    >
      <div className="flex flex-col gap-5 p-5">
        <EntryItem index={0}>
          <Section title="Net sales" data={sections.sales} askAbout>
            {(d) => <Strip cells={[{ label: "Net sales", value: money(d.netSales), size: "lead" }]} />}
          </Section>
        </EntryItem>

        <EntryItem index={1}>
          <Section title="Sales per labour hour" data={sections.splh}>
            {() => null}
          </Section>
        </EntryItem>

        <EntryItem index={2}>
          <Section
            title="Stores"
            meta={PRESETS.find((p) => p.id === counterParams.presetId)?.name}
            data={sections.ledger}
            askAbout="the per-store ledger"
          >
            {(rows) => (
              <Table
                columns={[
                  { key: "store", label: "Store" },
                  { key: "net", label: "Net sales", numeric: true },
                  { key: "cogsPct", label: "COGS %", numeric: true },
                  { key: "target", label: "vs target", numeric: true },
                ]}
                rows={rows.map((r) => ({
                  key: r.storeId,
                  cells: {
                    store: r.store,
                    net: money(r.net),
                    cogsPct: pct(r.cogsPct, { scaled: true }),
                    target: delta(r.deltaVsTargetPp, { scaled: true }),
                  },
                }))}
              />
            )}
          </Section>
        </EntryItem>

        <EntryItem index={3}>
          <Section title="Invoices" data={sections.invoices} askAbout>
            {(d) => (
              <Strip
                cells={[
                  { label: "Spend", value: money(d.spend) },
                  { label: "Invoices", value: d.count.toLocaleString("en-US") },
                  { label: "Needs review", value: d.needsReview.toLocaleString("en-US") },
                ]}
              />
            )}
          </Section>
        </EntryItem>

        <EntryItem index={4}>
          <Section title="Needs you" data={sections.needsYou}>
            {() => null}
          </Section>
        </EntryItem>

        <EntryItem index={5}>
          <Section title="The model's call" data={sections.modelCall}>
            {() => null}
          </Section>
        </EntryItem>
      </div>
    </AppShell>
  )
}
