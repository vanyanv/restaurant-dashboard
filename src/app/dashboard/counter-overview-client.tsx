"use client"

import { useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  AppShell,
  Dispatch,
  DateControl,
  Section,
  Strip,
  Figure,
  Table,
  type DispatchItem,
  type RailUser,
  type SwitchableStore,
} from "@/components/counter"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { rangeLabel, rangeSubtitle, rangeTitle, stepRange } from "@/lib/counter/date-range"
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

/**
 * The dispatch line's facts, and nowhere else to get them.
 *
 * The prototype's three are "3 need you · 1,284 orders trading · synced 12 min
 * ago". We have none of those yet: the needs-you count is an owed section, the
 * order count lives inside a `SectionData` this page may not open (a page never
 * branches on `.status` — `npm run tokens` fails the build on it), and this
 * application has no last-sync reading at all. What it DOES have, at page level
 * and with no status to inspect, is the store lifecycle — which is exactly the
 * third thing the design's own note asks this line for: "whether the figures
 * can be trusted". A pre-open store is why a page below is empty, and saying so
 * here is the difference between an empty dashboard and a broken one.
 *
 * Everything printed is derived. Nothing is invented, and the line goes short
 * rather than padded.
 */
function dispatchItems(
  stores: SwitchableStore[],
  selected: SwitchableStore | null,
): DispatchItem[] {
  if (selected) {
    if (selected.stage === "pre_open") {
      return [{ tone: "hot", text: `${selected.name} is not trading yet — nothing below counts it` }]
    }
    if (selected.stage === "warming_up") {
      return [{ tone: "quiet", text: `${selected.name} is warming up — its figures are still settling` }]
    }
    return [{ tone: "quiet", text: `${selected.name} is trading` }]
  }
  const trading = stores.filter((s) => s.stage === "trading").length
  const items: DispatchItem[] = [
    { tone: "quiet", text: `${trading} of ${stores.length} stores trading` },
  ]
  const rest = stores.length - trading
  if (rest > 0) {
    items.push({ tone: "quiet", text: `${rest} not trading yet, and nothing below counts them` })
  }
  return items
}

export function CounterOverviewClient({
  pathname,
  params: paramsString,
  stores,
  user,
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
  /** The signed-in reader, for the rail's account row. */
  user: RailUser
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
      // The title is a sentence about the WINDOW — "7 days to Aug 21" — not the
      // word "Overview", which the breadcrumb already says. Both strings come
      // from `date-range.ts` so no second page can word them differently.
      title={rangeTitle(counterParams.range)}
      sub={rangeSubtitle(
        selectedStore?.name ?? "All stores",
        counterParams.range,
        counterParams.comparisonId,
      )}
      crumbLeaf="Overview"
      actions={
        <DateControl
          presetId={counterParams.presetId}
          comparisonId={counterParams.comparisonId}
          range={counterParams.range}
          onPreset={(id) => push({ presetId: id })}
          onComparison={(id) => push({ comparisonId: id })}
          onStep={(direction) => push({ range: stepRange(counterParams.range, direction) })}
          onRange={(range) => push({ range })}
        />
      }
      stores={stores}
      selectedStoreId={counterParams.storeId}
      onSelectStore={(id) => push({ storeId: id })}
      storeName={selectedStore?.name ?? null}
      user={user}
      today={today}
      // The ⌘K palette's "Change the range" group, from the same state the
      // date control above is drawn from — so the two can never disagree
      // about which preset is current.
      presetId={counterParams.presetId}
      onSelectPreset={(id) => push({ presetId: id })}
    >
      {/* `.dispatch` is the first thing inside the screen, above everything.
          No `.go` action: the prototype's points at its alerts queue and ours
          would point at `/dashboard/needs-you`, which `nav.ts` declares and
          this application does not serve yet. A link to a 404 is worse than no
          link. */}
      <Dispatch items={dispatchItems(stores, selectedStore)} />

      {/* No `EntryItem` wrappers. `.screen > *` in the ported sheet already
          staggers these six in reading order, with its own reduced-motion
          branch — see the note on `EntryItem` itself. */}
      <Section title="Net sales" data={sections.sales} askAbout>
        {(d) => (
          <div className="headline">
            <Figure label="Net sales" value={money(d.netSales)} size="lead" />
          </div>
        )}
      </Section>

      <Section title="Sales per labour hour" data={sections.splh}>
        {() => null}
      </Section>

      <Section
        title="Stores"
        meta={rangeLabel(counterParams.range, counterParams.presetId)}
        data={sections.ledger}
        askAbout="the per-store ledger"
        // `raw()` in the prototype: a table fills its section edge to
        // edge. `.tbl` rules its own rows the full width of the box, so a
        // `.sec__body` gutter around it would stop every hairline 15px
        // short of the section's border. Every `sec(… tbl(…) …)` call in
        // the prototype does the same.
        pad={false}
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

      <Section title="Needs you" data={sections.needsYou}>
        {() => null}
      </Section>

      <Section title="The model's call" data={sections.modelCall}>
        {() => null}
      </Section>
    </AppShell>
  )
}
