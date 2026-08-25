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
  Figure,
  Table,
  type SwitchableStore,
} from "@/components/counter"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { rangeLabel, stepRange } from "@/lib/counter/date-range"
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
  invoices: SectionData<{ spend: number; count: number; needsReview: number; avgInvoice: number }>
  needsYou: SectionData<null>
  modelCall: SectionData<null>
}

export function CounterOverviewClient({
  pathname,
  params: paramsString,
  stores,
  today,
  sections,
}: {
  pathname: string
  /**
   * The query string Overview was rendered for, as PLAIN TEXT — not a
   * `URLSearchParams` instance. A page.tsx (Server Component) rendering this
   * client island passes props across the RSC boundary, which only carries
   * plain serialisable values; a `URLSearchParams` arrives on the client with
   * its prototype stripped (a real bug, caught only by loading this page in
   * an actual browser — a unit test that constructs the component directly,
   * with no serialisation boundary in between, cannot see it). Read for the
   * controls' state AND passed straight into `AppShell` so the Ask surface's
   * context sentence can never name a different range or store than what's
   * on screen.
   */
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: OverviewClientSections
}) {
  const router = useRouter()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  const push = useCallback(
    (next: Parameters<typeof writeCounterParams>[1]) => {
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
            onStep={(direction) => push({ range: stepRange(counterParams.range, direction) })}
          />
        </Topbar>
      }
    >
      <div className="flex flex-col gap-5 p-5">
        <EntryItem index={0}>
          {/* A single Figure, not a Strip — Strip's grid is 2/4 tracks wide
              and one cell inside it left the other tracks as bare hairline
              background (a grey rectangle beside the number). "lead" size
              is exactly for this: the one headline figure on a page.

              The `.headline` wrapper is not decoration. `size="lead"` emits
              the prototype's `<div class="fig">`, and every rule that sizes a
              lead figure is written as a DESCENDANT of `.headline`
              (`.headline .fig`, `.headline .k`, `.headline .v` — see
              counter-components.css). Outside one, `.fig` has no display:grid
              and the label and the figure run together at body size. The
              prototype never emits a `.fig` anywhere else either. The real
              headline block — two figures and the `.say` sentence beside them
              — is a later task; this is the one-child form of the same
              element. */}
          <Section title="Net sales" data={sections.sales} askAbout>
            {(d) => (
              <div className="headline">
                <Figure label="Net sales" value={money(d.netSales)} size="lead" />
              </div>
            )}
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
            meta={rangeLabel(counterParams.range, counterParams.presetId)}
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
                  { label: "Avg invoice", value: money(d.avgInvoice) },
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
