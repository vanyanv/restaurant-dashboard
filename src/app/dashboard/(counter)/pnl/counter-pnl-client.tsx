"use client"

import Link from "next/link"
import { Fragment, useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Cascade,
  DateControl,
  Lede,
  Note,
  PageHead,
  MoneyLines,
  Section,
  STAGE_TAG,
  Strip,
  Table,
  WeekTable,
  useCounterTransition,
  usePageChrome,
  type Column,
  type Row,
  type SwitchableStore,
} from "@/components/counter"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import {
  COMPARISONS,
  dayCount,
  rangeLabel,
  rangeSubtitle,
  stepRange,
  type ComparisonId,
} from "@/lib/counter/date-range"
import { count, money, pct } from "@/lib/counter/format"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
  PnlSections,
  PnlStatement,
  PnlStoreLine,
  ReadingSegment,
} from "@/lib/counter/adapters/pnl"
import type { StoreFixedSections } from "@/lib/counter/adapters/pnl-store"

/**
 * Counter P&L — the second Counter page, composed from `P.pnl.desk()`
 * (`docs/counter/counter-prototype.html:5245`) in the prototype's own order:
 *
 *   strip → the reading paragraph → the `.wf` cascade → the eight weeks →
 *   the statement table → the split of food-cause and trust → by store.
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

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** "Hollywood", "Hollywood and Glendale", "Hollywood, Glendale and Van Nuys". */
function names(lines: PnlStoreLine[]): string {
  if (lines.length === 0) return ""
  if (lines.length === 1) return lines[0].name
  return `${lines.slice(0, -1).map((l) => l.name).join(", ")} and ${lines[lines.length - 1].name}`
}

/**
 * The reading paragraph, as the prototype's `.ans__lead` — emphasis and all.
 *
 * The adapter decides WHICH figure carries the emphasis, because that is a
 * judgement about the data (`ReadingSegment`). A plain segment renders as a
 * text node, not a `<span>`: the prototype's paragraph has bold runs and bare
 * text, and wrapping the bare text would put elements in the DOM the sheet
 * never styles.
 */
function Reading({ segments }: { segments: ReadingSegment[] }) {
  return (
    <p className="ans__lead" style={{ margin: "16px 0 0" }}>
      {segments.map((s, i) =>
        s.strong ? <b key={i}>{s.text}</b> : <Fragment key={i}>{s.text}</Fragment>,
      )}
    </p>
  )
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
  const stageCount = new Set(stores.map((s) => s.stage)).size

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
          onStep={(direction) => push({ range: stepRange(range, direction) })}
          onRange={(next) => push({ range: next })}
        />
      </PageHead>

      {/* The strip and the sentence under it — one section, because the
          sentence is a reading OF those five figures. Both sit at page level,
          above the first `.sec`, as `P.pnl.desk()` writes them. */}
      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => (
          <>
            <Strip cells={h.cells} />
            <Reading segments={h.reading} />
          </>
        )}
      </Section>

      {/* Note 52: a statement is a sequence of subtractions, so it is drawn as
          one. `Cascade` computes the end from the cuts rather than taking it
          as a parameter, so the picture reconciles by construction. */}
      <Section
        title="Where it went"
        pending={pending}
        meta={`${windowLabel} · the bar is what is left after each line`}
        data={sections.cascade}
        askAbout="where the money went"
      >
        {(c) => <Cascade start={c.start} cuts={c.cuts} end={c.end} />}
      </Section>

      {/* Note 53. Pressing a row writes `?from=…&to=…`, which moves the date
          control above and every figure on the page with it — the promise the
          row makes ("these are the figures you will see") kept by navigating
          to the same window the row was loaded over. */}
      <Section
        title="The last eight weeks"
        pending={pending}
        meta="press a week to read it in full · every figure is this same statement over that window"
        data={sections.weeks}
        askAbout="the last eight weeks"
      >
        {(w) => (
          <WeekTable
            weeks={w.rows}
            selected={range}
            selectedLabel={windowLabel}
            foodTargetPct={w.foodTargetPct}
            onSelect={(next) => push({ range: next })}
          />
        )}
      </Section>

      <Section
        title="The statement"
        pending={pending}
        meta={
          comparing
            ? `against ${cmpName} · same ${days} ${plural(days, "day", "days")}, so the change column is readable`
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

      {/* Both halves are owed, and both name what is missing rather than
          drawing half an answer as a whole one. `Section` renders that; this
          page only says where the two blocks sit. */}
      <div className="split">
        <Section
          title="What is behind the food line"
          pending={pending}
          meta="points of the food gap, per cause"
          data={sections.foodCause}
        >
          {() => null}
        </Section>
        <Section
          title="How much of this is measured"
          pending={pending}
          meta="and how much is an estimate"
          data={sections.trust}
        >
          {() => null}
        </Section>
      </div>

      {/* The section that answers which stores are IN the statement above and
          which are not — so it is deliberately NOT scoped to the selection. */}
      <Section
        title="By store"
        pending={pending}
        // The prototype's "3 stores, 3 stages". Counted off the switcher's own
        // list, which is page state — the section's rows are the same set, but
        // a `meta` is drawn beside the title whatever the body turned out to be.
        meta={`${count(stores.length)} ${plural(stores.length, "store", "stores")}, ${count(stageCount)} ${plural(stageCount, "stage", "stages")}`}
        data={sections.byStore}
        pad={false}
        askAbout="how the stores compare"
      >
        {(lines) => <ByStore lines={lines} />}
      </Section>
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

const BY_STORE_COLUMNS: Column[] = [
  { key: "store", label: "Store" },
  // "Gross", not the prototype's "Net": this figure IS `grossSales`, the same
  // one the statement above heads "Gross sales". See the file note.
  { key: "gross", label: "Gross", numeric: true },
  { key: "prime", label: "Prime", numeric: true },
  { key: "fixed", label: "Fixed on file", numeric: true },
  { key: "stage", label: "Stage" },
]

/**
 * Every store on the account, and the sentence that says why only some of them
 * are in the statement above.
 *
 * The sentence says "in this range" rather than naming the window: the page
 * head and this section's own meta both name it already, and a preset's name
 * dropped mid-sentence ("with sales over Last 7 days") reads as a typo.
 *
 * The prose is derived from the rows, never written for one account: "Every
 * line above is Hollywood, because it is the only store with sales" is a
 * sentence about whichever stores traded, and an account where all three trade
 * gets a different one.
 */
function ByStore({ lines }: { lines: PnlStoreLine[] }) {
  const trading = lines.filter((l) => l.grossSales !== null)
  const silent = lines.filter((l) => l.grossSales === null)
  const noRent = lines.filter((l) => !l.rentOnFile)

  const rows: Row[] = lines.map((l) => ({
    key: l.id,
    cells: {
      store: <b>{l.name}</b>,
      gross: money(l.grossSales),
      prime: pct(l.primePct, { scaled: true }),
      // The prototype's own treatment: ONE warn-coloured cell, and the row
      // left alone. The sheet's `is-hole` pair was tried here and is wrong —
      // it washes the whole row in `--bad-wash` and italicises the cell in
      // `--bad`, which is what a document line that is WRONG looks like. A
      // pre-open store with no rent yet is not wrong, it is early, and the
      // Stage column beside it already says so.
      fixed: l.rentOnFile ? money(l.fixedOnFile) : <span className="text-ct-warn">not on file</span>,
      stage: <span className={STAGE_TAG[l.stage].className}>{STAGE_TAG[l.stage].label}</span>,
    },
  }))

  return (
    <>
      <div className="sec__body">
        <Lede>
          {trading.length === 0 ? (
            <>
              No store took anything in this range, so the statement above has nothing to
              subtract from. The table is what is known about {plural(lines.length, "it", "them")}{" "}
              meanwhile.
            </>
          ) : (
            <>
              Every line above is {names(trading)}, because{" "}
              {plural(trading.length, "it is the only store", "they are the only stores")} with
              sales in this range.
              {silent.length > 0 ? (
                <>
                  {" "}
                  {names(silent)} {plural(silent.length, "has", "have")} none, so{" "}
                  {plural(silent.length, "it carries", "they carry")} no line above. The table is
                  what is known about {plural(silent.length, "it", "them")} meanwhile.
                </>
              ) : null}
            </>
          )}
        </Lede>
      </div>

      <Table columns={BY_STORE_COLUMNS} rows={rows} />

      <div className="sec__body">
        {noRent.length > 0 ? (
          <p className="callout">
            {count(noRent.length)} of {count(lines.length)}{" "}
            {plural(noRent.length, "carries", "carry")} no rent on file, which is the single field
            that would let {plural(noRent.length, "it", "them")} join the statement above.{" "}
            <b>
              Until it is filled in, folding {plural(noRent.length, "it", "them")} in would make the
              group look more profitable than it is.
            </b>
          </p>
        ) : (
          <p className="callout">
            Every store carries a rent line, so nothing is held out of the statement above for a
            missing file.
          </p>
        )}
        <div className="btnrow" style={{ marginTop: "11px" }}>
          <Link className="btn btn--primary" href="/dashboard/stores">
            Fill in a store file
          </Link>
        </div>
      </div>
    </>
  )
}
