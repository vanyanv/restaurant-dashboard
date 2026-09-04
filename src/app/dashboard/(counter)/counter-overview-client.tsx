"use client"

import Link from "next/link"
import { useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  ChannelRows,
  CountUp,
  Dispatch,
  DateControl,
  Drill,
  FloorMeter,
  HeadBlock,
  LeadFigure,
  MoneyLines,
  Moving,
  PageHead,
  Queue,
  Say,
  Section,
  Stars,
  StoreCards,
  Strip,
  Table,
  useCounterTransition,
  type DispatchItem,
  type QueueItem,
  type StoreCard,
  type SwitchableStore,
} from "@/components/counter"
import {
  AskBar,
} from "@/components/counter/ask"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import {
  bucketFor,
  COMPARISONS,
  dayCount,
  rangeLabel,
  rangeSubtitle,
  rangeTitle,
  stepRange,
  type ComparisonId,
  type DateRange,
} from "@/lib/counter/date-range"
import { count, money, plural } from "@/lib/counter/format"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
  OverviewSections,
  OverviewStoreCard,
  QueueEntry,
} from "@/lib/counter/adapters/overview"

/**
 * What `page.tsx` hands this island — already shaped exactly the way each
 * primitive below renders it. `src/lib/counter/adapters/overview.ts` is where
 * that shaping happens; this file never inspects `.status` (the six renderings
 * all live inside `Section`) and never formats a number a second way.
 *
 * The type is the adapter's own, imported rather than restated: a second
 * hand-written copy of fourteen section shapes here would be fourteen chances
 * for the two to drift.
 *
 * ## The order below is `P.overview.desk()`'s order, and it is load-bearing
 *
 * `docs/counter/counter-prototype.html:4219`. Two constraints break the layout
 * silently if they are missed, and both were measured rather than guessed:
 *
 * 1. **The head block, the strip, the moving band, the ask bar and the
 *    comparison drill sit at PAGE level**, above and between the six sections
 *    — not inside one. Before this composition our head figure lived inside
 *    the first `.sec`, and the fidelity gate reported `.headline`, `.fig`,
 *    `.strip` and `.tbl` as four EXTRA landmarks at the wrong index, purely
 *    because everything above them was missing.
 * 2. **Every store card precedes every drawer** inside `.stores`, because
 *    `.stores > .ldrawer` is `grid-column: 1 / -1`. `StoreCards` enforces that
 *    itself; it is recorded here because it is the reason it does.
 *
 * ## What is on this page and is not a `.sec`
 *
 * Five blocks, and all five still have states. `Section bare` is how they get
 * them: the same six branches and the same five state components, without the
 * `.sec` chrome. A second component rendering "failed" its own way is the one
 * thing note 22 forbids.
 *
 * ## What the prototype has here and this page does not
 *
 * - **A build-out meter on a pre-open store card.** No column, no milestone
 *   table, nothing — see `PreOpenStore`. The card carries the opening date and
 *   what its store file is still missing instead.
 * - **A floor under sales per labour hour.** `SPLH_FLOOR = 68.00` is the
 *   prototype's own invention and `SplhPoint.targetSplh` is the figure judging
 *   itself. `FloorMeter` mounts only when a floor is published, so today it
 *   does not mount at all.
 * - **A band under four of the six strip figures.** Only food cost has a
 *   published target (`Store.targetCogsPct`) and only prime cost has a
 *   published ceiling (a trade benchmark, not a per-store setting). The rest
 *   are judged against nothing, because nothing publishes anything to judge
 *   them against.
 * - **The model's call.** The prototype mounts it only on a single-day range,
 *   and `getRevenueForecast`'s horizon starts TODAY while this page's default
 *   range ends yesterday — so it would be a permanently empty box on the view
 *   a reader lands on. `/dashboard/forecasts` serves it as a page.
 *
 * ## What this island receives, per section
 *
 * The resolved `SectionData` or the PROMISE of it (`SectionSources`).
 *
 * The page hands over promises — `Section` opens a Suspense boundary per
 * section and unwraps each with `use()`, so one slow query holds up one
 * section and nothing else. The union keeps the resolved half so this island
 * renders identically when it is handed finished data, which is what every
 * test of it does and what makes those tests worth anything.
 */
export type OverviewClientSections = SectionSources<OverviewSections>

/**
 * The dispatch line's facts, and nowhere else to get them.
 *
 * The prototype's three are "3 need you · 1,284 orders trading · synced 12 min
 * ago". We have none of those three at page level: the needs-you count and the
 * order count both live inside a `SectionData` this page may not open (a page
 * never branches on `.status`), and this application has no last-sync reading
 * at all. What it DOES have, at page level and with no status to inspect, is
 * the store lifecycle — which is exactly the third thing the design's own note
 * asks this line for: "whether the figures can be trusted". A pre-open store is
 * why a page below is empty, and saying so here is the difference between an
 * empty dashboard and a broken one.
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

/** "the prior period" — the comparison named the way a sentence names it. */
function comparisonLabel(id: ComparisonId): string {
  return (COMPARISONS.find((c) => c.id === id)?.label ?? "with no comparison").replace(/^vs /, "")
}

const BUCKET_WORD = { day: "daily", week: "weekly", month: "monthly" } as const

/** "Net sales" on one day, "Net sales · 7 days" on more. The prototype's own two forms. */
function netSalesLabel(range: DateRange): string {
  const n = dayCount(range)
  return n === 1 ? "Net sales" : `Net sales · ${n} days`
}

export function CounterOverviewClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  /**
   * The query string Overview was rendered for, as PLAIN TEXT — not a
   * `URLSearchParams` instance. A page.tsx (Server Component) rendering this
   * client island passes props across the RSC boundary, which only carries
   * plain serialisable values; a `URLSearchParams` arrives on the client with
   * its prototype stripped (a real bug, caught only by loading this page in
   * an actual browser — a unit test that constructs the component directly,
   * with no serialisation boundary in between, cannot see it). Read for the
   * controls' state — the date control's presets, comparison and range —
   * and nothing is passed into `AppShell` any more: the rail, topbar and
   * store switcher live in the layout now and read the URL directly.
   */
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: OverviewClientSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  /*
   * The ONE transition shared with `AppShell`'s own store switcher — see
   * `counter-transition.tsx`. `pending` is threaded to every `<Section>`
   * below, which is what turns a range/comparison change into a stale banner
   * over the last good figures instead of a blank `loading.tsx`.
   */
  const { pending, startTransition } = useCounterTransition()

  const push = useCallback(
    (next: Parameters<typeof writeCounterParams>[1]) => {
      const nextParams = writeCounterParams(params, next)
      const qs = nextParams.toString()
      // push, not replace: note 19's "a range that only changes the label is
      // a lie" cuts the other way too — a range change is a real navigation
      // an owner expects the back button to undo.
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      })
    },
    [params, pathname, router, startTransition],
  )

  const { range, presetId, comparisonId } = counterParams
  const selectedStore = stores.find((s) => s.id === counterParams.storeId) ?? null
  const storeName = selectedStore?.name ?? "all stores"
  const windowLabel = rangeLabel(range, "custom")
  const buckets = BUCKET_WORD[bucketFor(range)]
  const comparing = comparisonId !== "none"
  const cmpName = comparisonLabel(comparisonId)

  /**
   * A card, and the channel panel that opens under it.
   *
   * The panel is built HERE rather than in the adapter because it is markup,
   * and a `ReactNode` cannot cross the RSC boundary. Every figure inside it
   * came from the adapter already.
   */
  const toCard = (c: OverviewStoreCard): StoreCard => {
    if (c.kind === "pre_open") {
      return {
        ...c,
        // `rows={[]}` is `prePanel()`: the same `.chan` box, saying what the
        // store is waiting for instead of where its money came from.
        panel: (
          <ChannelRows
            caption={`${c.name} is not trading yet`}
            rows={[]}
            footer={
              c.missingFromFile.length === 0
                ? "Its store file is complete. Nothing here will be counted until it opens."
                : `Its store file is still missing ${c.missingFromFile.join(", ").toLowerCase()}.`
            }
            actions={
              <Link className="btn" href={`/dashboard/stores/${c.id}`}>
                Open the store file
              </Link>
            }
          />
        ),
      }
    }
    return {
      ...c,
      panel: (
        <ChannelRows
          caption={`Where ${c.name}'s ${money(c.grossSales)} came from · ${windowLabel}`}
          rows={c.channels}
          footer={
            c.channels.length === 0
              ? "No channel readings for this range."
              : `${count(c.orders)} orders across ${c.channels.length} channels.`
          }
          actions={
            <>
              <Link className="btn" href={`/dashboard/pnl/${c.id}`}>
                Open this store&rsquo;s P&amp;L
              </Link>
              <Link className="btn" href={`/dashboard/stores/${c.id}`}>
                Open the store file
              </Link>
            </>
          }
        />
      ),
    }
  }

  /**
   * `QueueEntry` -> `QueueItem`. The adapter names a destination; a handler is
   * not serialisable, so turning the name into behaviour is this island's job
   * — the same split as `SectionData.failed`'s `retryAction`.
   */
  const toQueueItem = (e: QueueEntry): QueueItem =>
    e.href && e.actLabel
      ? {
          key: e.key,
          tone: e.tone,
          lead: e.lead,
          unit: e.unit,
          title: e.title,
          body: e.body,
          act: e.actLabel,
          onAct: () => router.push(e.href as string),
        }
      : { key: e.key, tone: e.tone, lead: e.lead, unit: e.unit, title: e.title, body: e.body }

  return (
    /*
     * A FRAGMENT, not a shell. The rail, the topbar, the store switcher and
     * the ⌘K surface are `src/app/dashboard/(counter)/layout.tsx`'s now — they
     * are URL-driven, so hoisted into the layout they read the URL and push
     * their own changes, and `stores` / `user` / `presetId` / `onSelectPreset`
     * / `selectedStoreId` / `onSelectStore` / `storeName` / `pathname` /
     * `params` all disappeared from this call rather than moving up it.
     *
     * `PageHead` stays, first inside `#ct-main`, exactly where the shell used
     * to render it — the title sentence, the sub-line and the date control are
     * genuinely this page's, and they are the only part of the old `AppShell`
     * call that the fidelity gate measures.
     */
    <>
      <PageHead
        // The title is a sentence about the WINDOW — "7 days to Aug 21" — not
        // the word "Overview", which the breadcrumb already says. Both strings
        // come from `date-range.ts` so no second page can word them
        // differently.
        title={rangeTitle(range)}
        sub={rangeSubtitle(selectedStore?.name ?? "All stores", range, comparisonId)}
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

      {/* `.dispatch` is the first thing inside the screen, above everything.
          No `.go` action: the prototype's points at its alerts queue and ours
          would point at `/dashboard/needs-you`, which `nav.ts` declares and
          this application does not serve yet. A link to a 404 is worse than no
          link. */}
      <Dispatch items={dispatchItems(stores, selectedStore)} />

      {/* Note 30, as two figures and a verdict: net sales says whether the day
          happened, sales per labor hour says whether it was worth having.
          Three sections, one block — they come from three rollups that fail
          independently, so each figure carries its own state and the block
          holds whichever of them arrived. */}
      <HeadBlock
        figures={[
          <Section bare key="net" title="Net sales" data={sections.sales} pending={pending}>
            {(d) => (
              <LeadFigure
                label={netSalesLabel(range)}
                // The figure arrives: it counts up to the rollup's number over
                // 480ms, worded by the same `money` it would be worded by at
                // rest. Data arriving is louder than a hover and quieter than
                // a figure that needs the reader — see the motion block in
                // `counter-repairs.css` for the hierarchy.
                value={<CountUp value={d.grossSales} format={(v) => money(v)} />}
                detail={d.comparison}
                // The adapter decides this, not the arrow in the string: net
                // sales is a figure whose direction and sentiment agree, and
                // until the sheet was corrected a 37.2% FALL printed here in
                // the colour of a rise.
                detailTone={d.comparisonTone}
              />
            )}
          </Section>,
          <Section bare key="splh" title="Sales per labor hour" data={sections.splh} pending={pending}>
            {(d) => (
              <LeadFigure
                label="Sales per labor hour"
                value={<CountUp value={d.value} format={(v) => money(v, { cents: true })} />}
                // "1 daily readings" was on the first screen at this page's own
                // default range. `plural` agrees the noun with the number.
                detail={`${plural(d.series.length, `${buckets} reading`)} with labor posted`}
                // A statement of fact about the window, not a movement. Left
                // unclassed it paints `var(--good)`, which says "good news"
                // about a reading count.
                detailTone="is-flat"
                // Only when a floor is published. Nothing in this schema
                // publishes one, so nothing is drawn against one — a meter
                // against a number nobody set is the prototype's own 68.00.
                meter={d.floor === null ? null : <FloorMeter value={d.value} floor={d.floor} />}
              />
            )}
          </Section>,
        ]}
      >
        <Section bare title="The verdict" data={sections.verdict} pending={pending}>
          {(v) => (
            <Say tone={v.tone} headline={v.headline} action={v.action}>
              {v.body}
            </Say>
          )}
        </Section>
      </HeadBlock>

      {/* The ruled strip. `Strip` sizes itself from `cells.length`, so a strip
          missing a figure the database cannot produce is a shorter strip
          rather than a bordered box reading "—". */}
      <Section bare title="The figures" data={sections.strip} pending={pending}>
        {(cells) => <Strip cells={cells} />}
      </Section>

      {/* Every cell names something the figures above it do NOT include. */}
      <Section bare title="Still moving" data={sections.moving} pending={pending}>
        {(cells) => <Moving cells={cells} />}
      </Section>

      {/* Not a section in the prototype either, and it carries no state: a
          store that is not trading is still a store you can ask about. */}
      <AskBar
        placeholder={`Ask anything about ${storeName}, ${windowLabel} or any range…`}
        suggestions={[
          "Why is food cost where it is?",
          comparing ? `What changed vs ${cmpName}?` : "What changed over this range?",
          "Which channel is costing the most to sell through?",
        ]}
      />

      {/* The two lead figures, as trends. Both are sections, so both carry all
          six states rather than only the one somebody remembered. */}
      <div className="split">
        <Section
          title={`Net sales · ${windowLabel}`}
          pending={pending}
          /*
           * WHAT IS ACTUALLY DRAWN, which at a one-bucket range is not a line.
           *
           * `Chart` has a documented single-reading branch: below two labels
           * it draws the reading and its comparison as two cells rather than
           * a bar and a dashed prior, because one bar is not a shape. This
           * caption did not know that, so the page's DEFAULT range — one day —
           * captioned two read-out boxes "dashed line: the prior period ·
           * 1 daily buckets", promising a line that was never coming and
           * getting the plural wrong on the way.
           *
           * A function of the data rather than of `range`, so the caption is
           * derived from the same array the chart is drawn from and the two
           * cannot disagree about how many buckets there turned out to be.
           */
          meta={(spec) =>
            spec.labels.length < 2
              ? comparing
                ? `one reading · ${cmpName} beside it`
                : "one reading · no line to draw"
              : comparing
                ? `dashed line: ${cmpName} · ${plural(spec.labels.length, `${buckets} bucket`)}`
                : `hover for the reading · ${plural(spec.labels.length, `${buckets} bucket`)}`
          }
          data={sections.salesChart}
          askAbout="net sales over this range"
        >
          {(spec) => (
            <>
              <Chart {...spec} fmt={(v) => money(v)} />
              <div className="btnrow">
                <Link className="btn btn--quiet" href="/dashboard/analytics">
                  Where it came from
                </Link>
              </div>
            </>
          )}
        </Section>

        <Section
          title="Sales per labor hour"
          // Same as the panel beside it: at one bucket `Chart` draws a reading,
          // not a series, and this said "daily readings" over it.
          meta={(spec) => plural(spec.labels.length, `${buckets} reading`)}
          data={sections.splhChart}
          pending={pending}
          askAbout="sales per labor hour"
        >
          {(spec) => (
            <>
              <Chart {...spec} fmt={(v) => money(v, { cents: true })} />
              {/* The prototype draws a floor rule here and writes a sentence
                  about it. No store file publishes a floor, so there is no
                  rule — and this says so, rather than leaving a reader to
                  wonder whether the line simply failed to draw. */}
              <p className="mono">
                Every hour of labor posted in this range returned this much in sales. No floor is
                published for {storeName}, so nothing is drawn against one.
              </p>
            </>
          )}
        </Section>
      </div>

      {/* The comparison, all of it, one click under the chart that draws it,
          at the width of the page — a four-column table in a 340px column
          wraps every row it has. Mounted only when a comparison is on, which
          is `P.overview.desk()`'s own `cmpOn &&` (line 4340) and is page
          state, not a section's status. */}
      {comparing ? (
        <Section bare title="Every figure against the comparison" data={sections.comparison} pending={pending}>
          {(rows) => (
            <Drill wide label={`Every figure against ${cmpName}`}>
              <Table
                columns={[
                  { key: "figure", label: "Figure" },
                  { key: "now", label: "This range", numeric: true },
                  { key: "then", label: "Comparison", numeric: true },
                  { key: "change", label: "Change", numeric: true },
                ]}
                rows={rows.map((r) => ({
                  key: r.key,
                  cells: {
                    figure: r.figure,
                    now: r.now,
                    then: r.then,
                    // `hot` is the prototype's own class for a cell that moved
                    // the wrong way; the ported sheet paints it.
                    change: { v: r.change, cls: r.bad ? "hot" : undefined },
                  },
                }))}
              />
            </Drill>
          )}
        </Section>
      ) : null}

      <Section title="What needs you" data={sections.needsYou} pending={pending} askAbout="what needs me">
        {(items) => <Queue items={items.map(toQueueItem)} />}
      </Section>

      {/* Where the money came from belongs to the store that made it. And a
          store that has not opened belongs in something other than a row —
          note 33, the element this whole effort was diagnosed on. */}
      <Section
        title="Per-store ledger"
        pending={pending}
        meta={`${windowLabel} · open a store for where its money came from`}
        data={sections.stores}
        askAbout="the per-store ledger"
      >
        {(cards) => (
          <StoreCards
            stores={cards.map(toCard)}
            /* The prototype opens the SELECTED store's card (`here === id`,
               line 3907). With no store selected it opens the first trading
               one, because "open a store for where its money came from" is
               what this section is for and a page of shut drawers answers
               nothing. */
            defaultOpenId={
              counterParams.storeId ?? cards.find((c) => c.kind === "trading")?.id
            }
            notes={[
              `Every figure is ${windowLabel}.`,
              "Net sales across the cards sum to the headline, because both come from one rollup.",
            ]}
          />
        )}
      </Section>

      <div className="tri tri--2">
        {/* Four figures became money lines: what arrived, what is held up, and
            what actually reached COGS. `MoneyLines` is the prototype's own
            element for a short reconciliation, and the adapter writes the
            lines because a page never formats a number a second way. */}
        <Section title="Invoices" data={sections.invoices} pending={pending} askAbout>
          {(rows) => <MoneyLines rows={rows} />}
        </Section>

        <Section title="Guest ratings" data={sections.ratings} pending={pending} askAbout>
          {(r) => (
            <>
              <div className="stars">
                <span className="n tabular-nums lining-nums">{r.average}</span>
                {/* The scale a sighted reader reads off five glyphs, in the
                    one form a screen reader gets it: the glyphs themselves are
                    `aria-hidden` inside `Stars`. */}
                <span className="sr-only">out of 5</span>
                <Stars value={r.averageValue} />
              </div>
              <p className="mono">
                {count(r.count)} reviews in {count(r.windowDays)} days
                {r.lowCount > 0 ? ` · ${count(r.lowCount)} at one or two stars` : ""}
              </p>
            </>
          )}
        </Section>
      </div>
    </>
  )
}
