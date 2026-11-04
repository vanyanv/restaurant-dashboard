"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  DateControl,
  Note,
  PageHead,
  MoneyLines,
  Section,
  SubNav,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
  type Row,
  type SwitchableStore,
} from "@/components/counter"
import { storeViewTabs } from "@/lib/counter/nav"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import {
  COMPARISONS,
  dayCount,
  rangeLabel,
  rangeSubtitle,
  type ComparisonId,
} from "@/lib/counter/date-range"
import { money, plural } from "@/lib/counter/format"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
  PnlSections,
  PnlStatement,
} from "@/lib/counter/adapters/pnl"
import type { StoreFixedSections } from "@/lib/counter/adapters/pnl-store"
import { PlainDays, PlainDollar, PlainHero, PlainStatuses, PlainStores, PlainTodos } from "./pnl-plain-ui"

/**
 * Counter P&L, "made plain" (owner-approved 2026-11-03; mock
 * https://claude.ai/artifact/EjD7D1265pyAu9PS8zz4xf):
 *
 *   what you kept (big figure, vs the prior period, the eight weeks as the
 *   picker, each input's status in words) → Needs you (folded) → where each
 *   dollar went → day by day → by store → the full statement (folded).
 *
 * The first five blocks read ONE section, `plain` (`src/lib/counter/pnl-plain.ts`).
 * It replaced the prototype's strip, reading, cascade, week table, the two
 * owed "trust"/"food cause" boxes and the by-store table, so this page no
 * longer follows `P.pnl.desk()` and the fidelity structure pass reports that
 * by design. The adapter still serves the old sections; the phone and the
 * statement still read `statement`.
 *
 * A page composes primitives and calls exactly one adapter; it never imports
 * Prisma or an action directly and never inspects `SectionData.status` —
 * `npm run tokens` fails the build on either. `Section` is the sole state
 * renderer, `bare` for the two blocks that are not `.sec` here.
 *
 * ## What sits OUTSIDE a section, and why it is load-bearing
 *
 * The strip and the reading paragraph are page-level, above the first `.sec`,
 * exactly as they are on the Overview and exactly as `P.pnl.desk()` writes
 * them (`strip([…]) + lead + sec(…)`). They are ONE `SectionData` — the
 * adapter's `headline` — because the sentence is a reading OF the five
 * figures, and a page that could show one without the other would print a
 * paragraph about numbers that failed to load.
 *
 * ## What the prototype has here and this page does not
 *
 * - **A gap bar under "What is behind the food line".** Nothing in this schema
 *   attributes points of the food line to an ingredient (see the adapter's
 *   `foodCause`), and a `GapBar` whose only segment is the derived residual
 *   would be a picture of an explanation with no explanation in it.
 * - **A trust panel.** Note 44 wants every line split into measured / prorated
 *   / a rate / not yet posted. The rollup reports one labour figure per store
 *   without saying which days Harri covered, and `getInvoiceSummary` reports
 *   invoices IN REVIEW rather than food that belongs inside this range.
 * - **A labour band on the strip's labour cell.** `targets.labor` is `null`;
 *   the prototype's 23.9–26.2% "with salaried" exists nowhere in this schema.
 * - **The two buttons under the empty state.** `Section` owns every state, so
 *   an account with no statement gets `Empty`'s own reason and back-out rather
 *   than a page-shaped `.empt` block this file would have to branch to build.
 *
 * ## Two words that are NOT the prototype's, and both are deliberate
 *
 * 1. **The by-store money column is headed "Gross", not the prototype's
 *    "Net".** `PnlStoreLine.grossSales` IS `StoreStatement.grossSales` — the
 *    same figure the statement above heads "Gross sales". The prototype
 *    contradicts itself here: `pnl().gross = R.netTotal()`, so its statement
 *    heads that value "Gross sales" and its by-store column heads it "Net".
 *    This table sits under the statement and opens by referring to it, so it
 *    follows the statement's word. One page, one number, one name.
 * 2. **"not on file" is a token utility, not an inline colour.** The prototype writes
 *    `style="color:var(--warn)"`; a Counter page's only colour source is the
 *    `ct-` token layer, and `text-ct-warn` resolves to the same token.
 */

/** The shapes `page.tsx` hands this island — the adapter's own, imported rather than restated. *
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
export type CounterPnlSections = SectionSources<PnlSections>

/** "the prior period" — the comparison named the way a sentence names it. */
function comparisonName(id: ComparisonId): string {
  return (COMPARISONS.find((c) => c.id === id)?.label ?? "with no comparison").replace(/^vs /, "")
}


/** The statement's nine lines as `.tbl` rows. `href` makes a row open a page (note 47). */
function statementRows(s: PnlStatement): Row[] {
  return s.lines.map((l): Row => {
    const cells = {
      line: (
        <>
          {l.strong ? <b>{l.name}</b> : l.name}
          {l.sub ? <span className="pt"> · {l.sub}</span> : null}
        </>
      ),
      amount: l.amount,
      share: l.share,
      comparison: l.comparison,
      // `hot` is the ported sheet's own class for a change worth a reader's
      // eye. It is an EMPHASIS rule, not a verdict — see the footnote below
      // the table, which states the thresholds out loud.
      change: { v: l.change, cls: l.loud ? "hot" : undefined },
      worth: l.worth,
    }
    return l.href
      ? { key: l.key, cells, href: l.href, ariaLabel: `Open ${l.name}` }
      : { key: l.key, cells }
  })
}

/** The ⌘K palette's "Ask about P&L" group. Module-level, so the shell is not
 *  republished on every render of this page. */
const ASK_SUGGESTIONS = [
  "Why is the bottom line where it is?",
  "Which line moved most against the comparison?",
  "What would posting the outstanding invoices do to this?",
]

export function CounterPnlClient({
  params: paramsString,
  stores,
  today,
  sections,
  storeSections = null,
}: {
  /**
   * The query string this page was rendered for, as PLAIN TEXT — not a
   * `URLSearchParams` instance. Props cross the RSC boundary as plain
   * serialisable values only; a `URLSearchParams` arrives on the client with
   * its prototype stripped, which a unit test that constructs this component
   * directly cannot see and a browser catches immediately.
   */
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterPnlSections
  /**
   * `P.pnlstore`'s fixed-cost table, or null when no store is selected.
   *
   * Null rather than an empty section: with every store in view there is no
   * "this store's fixed costs" to show, and a section that renders its own
   * empty state would be answering a question nobody asked. Optional so that
   * rendering the group view — which is what a test constructing this
   * component directly is doing — needs no placeholder.
   */
  storeSections?: SectionSources<StoreFixedSections> | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  // The one chrome fact this page has that its URL does not.
  usePageChrome({ askSuggestions: ASK_SUGGESTIONS })

  /*
   * The ONE transition shared with `AppShell`'s own store switcher — see
   * `counter-transition.tsx`. `pending` is threaded to every `<Section>`
   * below, and `startTransition` wraps this page's own `push`, so a store
   * change from the rail and a range change from the date control mark the
   * same `stale`.
   */
  const { pending, startTransition } = useCounterTransition()

  const push = useCallback(
    (next: Parameters<typeof writeCounterParams>[1]) => {
      const nextParams = writeCounterParams(params, next)
      const qs = nextParams.toString()
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      })
    },
    [params, pathname, router, startTransition],
  )

  const { range, presetId, comparisonId } = counterParams
  const selectedStore = stores.find((s) => s.id === counterParams.storeId) ?? null
  const storeName = selectedStore?.name ?? "All stores"
  // The window named by its ENDS, on a preset as much as on a pressed range.
  //
  // `CD.rangeLabel()` in the prototype is `fmtRange()` (line 1862): two dates,
  // no preset branch, and `P.pnl.desk()` calls it for the cascade's meta (line
  // 5313) and the week table's unmarked note (line 5172). This page briefly
  // passed `presetId` instead, on the argument that the head should echo what
  // the date control CALLS the range — defensible on one surface and wrong
  // across two, because `/m/pnl` renders the same window from the same
  // adapter and names it by its ends. One range printed two ways on one page
  // is note 60's shape with no arithmetic in it. "Last 7 days" also never
  // says WHICH seven days, which is the only thing a statement's reader has
  // to know.
  const windowLabel = rangeLabel(range, "custom")
  const days = dayCount(range)
  const comparing = comparisonId !== "none"
  const cmpName = comparisonName(comparisonId)

  return (
    /*
     * A FRAGMENT: the rail, the topbar, the store switcher and the ⌘K surface
     * are `(counter)/layout.tsx`'s now. `crumbLeaf="P&L"` went with them and
     * did not need re-stating — `Topbar` derives the leaf from `pathname`
     * against the same `NAV_GROUPS` the rail lights its current item from, and
     * that destination is already called "P&L".
     */
    <>
      <PageHead
        // `P.pnl.title` is the page's NAME here, not the Overview's sentence
        // about the window: a statement is the same document whatever range it
        // is drawn over, and the range is the next line down.
        title="Profit and loss"
        // The prototype's own four terms — store, window, days, comparison. The
        // day count is the one this page cannot leave out: every fixed line
        // below is prorated across it.
        sub={rangeSubtitle(storeName, range, comparisonId, { days: true })}
      >
        <DateControl
          presetId={presetId}
          comparisonId={comparisonId}
          range={range}
          onPreset={(id) => push({ presetId: id })}
          onComparison={(id) => push({ comparisonId: id })}
          onRange={(next) => push({ range: next })}
        />
      </PageHead>

      {/* `VIEWS.pnl`'s group/store pair — see `storeViewTabs`. Analytics, Labor
          and COGS all carry this bar; the P&L, the fourth page in the design
          with a per-store twin, drew nothing and left `/dashboard/pnl/<id>`
          reachable only from the Overview. "One store" appears only once a
          store is picked. */}
      <SubNav items={storeViewTabs("/dashboard/pnl", counterParams.storeId, paramsString)} label="P&L" />

      {/* The page "made plain" (`pnl-plain.ts`, owner-approved 2026-11-03):
          the kept figure and how it moved, the eight weeks as the picker,
          each input's status in words, the gaps folded under Needs you, where
          each dollar went, and every day of the range. One section of data
          drawn as five blocks, so none can show a figure the others lack. */}
      <Section bare title="What you kept" data={sections.plain} pending={pending}>
        {(p) => (
          <>
            <PlainHero p={p} range={range} onWeek={(next) => push({ range: next })} />
            <PlainStatuses p={p} />
          </>
        )}
      </Section>

      <Section
        title="Needs you"
        fold="closed"
        meta={(p) => (p.todos.length > 0 ? plural(p.todos.length, "thing") : "nothing waiting")}
        data={sections.plain}
        pending={pending}
        pad={false}
      >
        {(p) => <PlainTodos p={p} />}
      </Section>

      <Section
        title="Where each dollar went"
        meta={(p) => (p.sales > 0 ? `out of ${money(p.sales)} in sales · change vs the period before` : windowLabel)}
        data={sections.plain}
        pending={pending}
      >
        {(p) => <PlainDollar p={p} />}
      </Section>

      <Section
        title="Day by day"
        meta={(p) => (p.days ? "tap a day to see every line" : "pick a week to see its days")}
        data={sections.plain}
        pending={pending}
        pad={false}
      >
        {(p) =>
          p.days ? (
            <PlainDays days={p.days} showStores={counterParams.storeId === null} />
          ) : (
            <p className="pl-nodays">
              This range is longer than a month. Pick one of the weeks above to see it day by day.
            </p>
          )
        }
      </Section>

      {counterParams.storeId === null ? (
        <Section
          title="By store"
          meta="tap one to read only that store"
          data={sections.plain}
          pending={pending}
          askAbout="how the stores compare"
        >
          {(p) => <PlainStores p={p} onStore={(id) => push({ storeId: id })} />}
        </Section>
      ) : null}

      <Section
        title="Full statement"
        fold="closed"
        pending={pending}
        meta={
          comparing
            ? `against ${cmpName} · same ${plural(days, "day")}, so the change column is readable`
            : `${windowLabel} · no comparison set, so there is no change column to read`
        }
        data={sections.statement}
      >
        {(s) => (
          <>
            <Table
              columns={[
                { key: "line", label: "Line" },
                { key: "amount", label: "This range", numeric: true },
                { key: "share", label: "% of sales", numeric: true },
                // The prototype's own header: the comparison's name, or the
                // absence of one said out loud rather than left blank.
                { key: "comparison", label: s.comparisonLabel ?? "no comparison", numeric: true },
                { key: "change", label: "Change", numeric: true },
                { key: "worth", label: "Worth", numeric: true },
              ]}
              rows={statementRows(s)}
            />
            {/* The prototype states its own emphasis rule under the table, and
                it has to: three of these nine numbers are painted and nothing
                else on the page says why. */}
            <Note>
              Change is in points of sales, and <b>Worth</b> is what that many points is in dollars
              at this range&rsquo;s volume. A line is called out when it moves more than the trade
              acts on: one point on food, two on labor, three on prime.
            </Note>
          </>
        )}
      </Section>

      {/* `P.pnlstore`'s fixed-cost table. Rendered only with a store selected,
          because that is what it is about — see the page's own note on why
          this is a section here rather than a route of its own. */}
      {storeSections ? (
        <Section
          title="What this store carries"
          meta={(f) => f.meta}
          data={storeSections.fixed}
          pending={pending}
          pad={false}
        >
          {(f) => (
            <>
              <div className="sec__body">
                <p className="ans__lead" style={{ margin: 0 }}>
                  {f.lead}
                </p>
              </div>
              <Table columns={FIXED_COLUMNS} rows={f.rows} />
              <div className="sec__body">
                <MoneyLines rows={f.money} />
                <Note>
                  {f.note}
                </Note>
              </div>
            </>
          )}
        </Section>
      ) : null}

    </>
  )
}

/** `P.pnlstore`'s own four: what it is, a month, this range, which line it lands on. */
const FIXED_COLUMNS: Column[] = [
  { key: "line", label: "Line" },
  { key: "monthly", label: "Monthly", numeric: true },
  { key: "range", label: "In this range", numeric: true },
  { key: "lands", label: "Lands on" },
]
