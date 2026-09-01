"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  DateControl,
  Donut,
  PageHead,
  Section,
  Strip,
  Table,
  Tag,
  useCounterTransition,
  usePageChrome,
  type Column,
  type Row,
  type SwitchableStore,
  SubNav,
} from "@/components/counter"
import { storeViewTabs } from "@/lib/counter/nav"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { pct } from "@/lib/counter/format"
import { rangeLabel, stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { CogsSections, MovedSection, ItemsSection } from "@/lib/counter/adapters/cogs"

/**
 * Counter COGS on the desk, composed from `P.cogs.desk()`
 * (`docs/counter/counter-prototype.html:5384`) in the prototype's own order:
 *
 *   strip → food cost against plan → a `.split` of what moved and the
 *   category ring → the items costing the most.
 *
 * The prototype opens with `strip([...])` and no head block, so there is no
 * `.headline`, no `.fig` and no `.say` on this page. The adapter's `figure`
 * and `verdict` are the phone's — `P.cogs.phone()` opens with `.mtitle` /
 * `.msub` — and rendering them here would put three landmarks on the desk that
 * the prototype does not have. An EXTRA landmark is never forgiven at the
 * fidelity gate.
 *
 * A page composes primitives and calls exactly one adapter; it never imports
 * Prisma or an action directly and never inspects `SectionData.status`.
 * `Section` is the sole state renderer, `bare` for the strip, which is not a
 * `.sec` here.
 *
 * ## THIS FILE DOES NO ARITHMETIC
 *
 * Every figure, caption, sentence and note below is a field of the adapter's
 * payload — including the one that decides the page. Food cost is the COST
 * from `DailyCogsItem` over the STATEMENT's Total Sales (C-R1); the same cost
 * over `DailyCogsItem.salesRevenue` reads 20.9% instead of 28.4%, and a COGS
 * page seven and a half points from the Analytics page three clicks away is
 * the defect that ruling exists to prevent. Nothing on this side of the
 * boundary can divide anything. `/m/cogs` renders the same fields from the
 * same call, so the two surfaces cannot print two food-cost percentages for
 * one window. The only strings this file writes are chrome — the page title,
 * the range in the subtitle, the column headings, and `PCT`, which cannot
 * cross the RSC boundary as a function.
 *
 * ## Four departures from the prototype, all forced by the data
 *
 * 1. **The strip is THREE cells, not four** (C-R3, C-R4). "Waste" is dropped
 *    because `InventoryAdjustment` has zero rows in the whole table and
 *    `StockCount` has four — there is no waste series and no honest way to
 *    invent one. "Theoretical" is dropped because `DailyCogsItem.lineCost`
 *    already IS the theoretical cost, so a cell reading it beside the food
 *    cost would be the same number twice. "Against plan" is added: it is the
 *    only extra figure this schema publishes a reference for
 *    (`Store.targetCogsPct`). `Strip` sizes itself from `cells.length`, so
 *    this is a shorter strip, not two boxes reading "—".
 *
 * 2. **The chart draws ONE line, not two** (C-R4). The prototype's dashed
 *    "Theoretical" series needs an ACTUAL to be read against, and the only
 *    actual available is purchasing — which is not consumption without an
 *    inventory bridge. Measured month by month the two swing 37% under to 38%
 *    over inside six months, which is invoice cadence, not waste. The
 *    section's `note` says so on the page rather than leaving it a silent gap,
 *    and with one series there is no `legend`.
 *
 * 3. **Not one sentence on this page says "over plan"** (C-R2). This
 *    restaurant runs INSIDE its published plan, and every string in `P.cogs`
 *    assumes an overshoot — "the red is the overshoot, not the measure", a
 *    cell reading "N pts over plan", a table headed "against plan". The
 *    adapter derives its own copy from the measured gap and its sign; none of
 *    the prototype's is ported. The chart's `fillFrom: plan` still works and
 *    simply fills nothing on a range spent under the line.
 *
 * 4. **The ring shows MENU categories** (C-R5). The prototype's slices are
 *    ingredient categories — Proteins, Produce, Dry goods — and
 *    `DailyCogsItem.category` holds the category of the item SOLD. Two
 *    different questions. The section is titled "By menu category" for what it
 *    actually shows rather than relabelling menu data with an ingredient word,
 *    and the adapter's `note` repeats it in the reader's own words.
 *
 * ## The caption-versus-delta trap
 *
 * Nothing here passes a `caption` to a `Figure`. `Figure` opens a `.band` on
 * `caption || reference`, so on the desk a caption with no reference renders
 * an EXTRA landmark, while `MCell` on the phone opens its band only inside
 * `reference ? … : ''` and renders NOTHING for the same prop. Every qualifier
 * on this page therefore rides in the delta slot, and the adapter gives each
 * one an explicit tone — an untoned `.strip .d` is `var(--good)`, which would
 * paint "13 in review · the whole backlog, not this range" green as if a
 * backlog were good news.
 */

/** The shapes `page.tsx` hands this island — the adapter's own, imported rather than restated. */
export type CounterCogsSections = SectionSources<CogsSections>

/**
 * The prototype's `PCT`. The plan chart's readings are already 0..100 — a
 * food-cost percentage and a plan rule share one axis — so this is `pct`'s
 * `scaled` form, the same one every other Counter percentage goes through.
 */
const PCT = (v: number) => pct(v, { scaled: true })

const MOVED_COLUMNS: Column[] = [
  { key: "ingredient", label: "Ingredient" },
  { key: "then", label: "Then", numeric: true },
  { key: "now", label: "Now", numeric: true },
  { key: "change", label: "Change", numeric: true },
  { key: "recipes", label: "Recipes", numeric: true },
]

const ITEM_COLUMNS: Column[] = [
  { key: "item", label: "Item" },
  { key: "foodPct", label: "Food %", numeric: true },
  { key: "sold", label: "Sold", numeric: true },
  { key: "againstPlan", label: "Against plan", numeric: true },
  { key: "lost", label: "Lost", numeric: true },
]

/** The ingredient prices that moved. The tone is the adapter's — a rise is bad news on a cost page. */
function movedRows(m: MovedSection): Row[] {
  return m.rows.map((row) => ({
    key: row.key,
    cells: {
      ingredient: <b>{row.ingredient}</b>,
      then: row.then,
      now: row.now,
      change: <Tag tone={row.changeTone}>{row.change}</Tag>,
      recipes: row.recipes,
    },
  }))
}

/** The items losing the most against plan. `hot` on the dollar column is the prototype's own. */
function itemRows(i: ItemsSection): Row[] {
  return i.rows.map((row) => ({
    key: row.key,
    cells: {
      item: <b>{row.item}</b>,
      foodPct: row.foodPct,
      sold: row.sold,
      againstPlan: <Tag tone={row.againstPlanTone}>{row.againstPlan}</Tag>,
      lost: { v: row.lost, cls: "hot" },
    },
  }))
}

/** The ⌘K palette's "Ask about COGS" group. Module-level, so the shell is not
 *  republished on every render of this page. */
const ASK_SUGGESTIONS = [
  "Are we inside our food-cost plan?",
  "Which ingredient prices moved this month?",
  "Which items lose the most against plan?",
]

export function CounterCogsClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  /**
   * The query string this page was rendered for, as PLAIN TEXT — not a
   * `URLSearchParams` instance. Props cross the RSC boundary as plain
   * serialisable values only; an instance arrives on the client with its
   * prototype stripped.
   */
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterCogsSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  usePageChrome({ askSuggestions: ASK_SUGGESTIONS })

  // The ONE transition shared with `AppShell`'s own store switcher, so a store
  // change from the rail and a range change from the date control mark the
  // same `stale`.
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
  const selectedStore = stores.find((s) => s.id === counterParams.storeId) ?? null
  const storeName = selectedStore?.name ?? "All stores"
  // The window named by its ENDS. NOT `rangeSubtitle`, which would append the
  // comparison's label: no section on this page is drawn against a comparison
  // window, and naming one in the subtitle would promise a reading that is
  // nowhere on the screen.
  const windowLabel = rangeLabel(range, "custom")

  return (
    /* A FRAGMENT: the rail, the topbar, the store switcher and the ⌘K surface
       belong to `(counter)/layout.tsx`. */
    <>
      <PageHead title="Cost of goods" sub={`${storeName} · ${windowLabel}`}>
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

      {/* `VIEWS`'s group/store pair — see `storeViewTabs`. "One store" appears
          only once a store is picked, which is the design's own sequence. */}
      <SubNav items={storeViewTabs("/dashboard/cogs", counterParams.storeId, paramsString, [{ label: "Theoretical vs actual", href: "/dashboard/operations/product-usage" }])} label="COGS" />

      {/* Page level, above the first `.sec`, exactly as `strip([...])` is
          written in `P.cogs.desk()`. Three cells (C-R3, C-R4). */}
      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      <Section
        title="Food cost against plan"
        pending={pending}
        // The adapter's: the range, the bucket grain, and the denominator that
        // decides the page. NOT the prototype's "the red is the overshoot, not
        // the measure" — there is no red on a range spent inside plan.
        meta={(p) => p.meta}
        data={sections.plan}
        askAbout="how food cost ran against the plan"
      >
        {(p) => (
          <>
            {/* `rule` and `fillFrom` are both the adapter's, both the published
                `Store.targetCogsPct`, and both absent together when no plan is
                published — a line filled from a plan invented here would be the
                page grading itself. */}
            <Chart {...p.chart} fmt={PCT} />
            <p className="mono" style={{ margin: "9px 0 0" }}>
              {p.sentence}
            </p>
            <p className="mono" style={{ margin: "9px 0 0" }}>
              {p.note}
            </p>
          </>
        )}
      </Section>

      <div className="split">
        <Section
          title="What moved"
          pending={pending}
          // Names the thirty-day window and the unit prices are normalized to,
          // because neither follows the date control above.
          meta={(m) => m.meta}
          data={sections.moved}
          // `tbl()` in the prototype IS a `raw()` body — a table fills the
          // section edge to edge and must not be inset a second time.
          pad={false}
          askAbout="which ingredient prices moved"
        >
          {(m) => (
            <>
              <Table columns={MOVED_COLUMNS} rows={movedRows(m)} />
              {/* NO `.sec__body` around these notes. `sec__body` is a landmark
                  class and `P.cogs.desk()` writes ZERO of them for this section
                  — `tbl()` returns `raw()`, so the prototype's `sec()` emits the
                  table alone. They carry the body's own inset
                  (`.sec__body{padding:13px 15px}`) inline rather than opening a
                  second landmark to get it. */}
              <p className="mono" style={{ margin: 0, padding: "13px 15px 0" }}>
                {m.sentence}
              </p>
              <p className="mono" style={{ margin: 0, padding: "9px 15px 13px" }}>
                {m.note}
              </p>
            </>
          )}
        </Section>

        <Section
          title="By menu category"
          pending={pending}
          meta={(c) => c.meta}
          data={sections.categories}
          askAbout="how the cost splits by menu category"
        >
          {(c) => (
            <>
              {/* `donut()` returns a bare string in the prototype, not `raw()`,
                  so this section keeps its `.sec__body` — unlike the two tables
                  either side of it. */}
              <Donut slices={c.slices} center={c.center} />
              <p className="mono" style={{ margin: "10px 0 0" }}>
                {c.sentence}
              </p>
              <p className="mono" style={{ margin: "9px 0 0" }}>
                {c.note}
              </p>
            </>
          )}
        </Section>
      </div>

      <Section
        title="The items costing the most"
        pending={pending}
        meta={(i) => i.meta}
        data={sections.items}
        pad={false}
        askAbout="which items are costing the most against plan"
      >
        {(i) => (
          <>
            <Table columns={ITEM_COLUMNS} rows={itemRows(i)} />
            {/* Unwrapped, for the reason the moved notes above are unwrapped.
                Why these rows do not sum to the headline: a different
                denominator, said out loud rather than left to be discovered. */}
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {i.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
