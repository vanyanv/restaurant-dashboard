"use client"

import { Fragment, useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  DateControl,
  HeadBlock,
  LeadFigure,
  PageHead,
  Queue,
  Say,
  Section,
  Strip,
  Table,
  Tag,
  WeekStrip,
  useCounterTransition,
  usePageChrome,
  type Column,
  type QueueItem,
  type Row,
  type SwitchableStore,
  SubNav,
} from "@/components/counter"
import { storeViewTabs } from "@/lib/counter/nav"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { pct } from "@/lib/counter/format"
import { rangeLabel, stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { LaborSections, LeakRowView, RolesSection, LeaksSection } from "@/lib/counter/adapters/labor"
import type { QueueEntry } from "@/lib/counter/adapters/overview"
import type { ReadingSegment } from "@/lib/counter/adapters/pnl"

/**
 * Counter Labor on the desk, composed from `P.labor.desk()`
 * (`docs/counter/counter-prototype.html:5528`) in the prototype's own order:
 *
 *   headBlock → strip → the week day by day → scheduled against actual →
 *   the staffing curve → a `.split` of by-role and the leak ledger →
 *   needs a decision → twelve weeks.
 *
 * A page composes primitives and calls exactly one adapter; it never imports
 * Prisma or an action directly and never inspects `SectionData.status`.
 * `Section` is the sole state renderer, `bare` for the head figures and the
 * strip, which are not `.sec`s here.
 *
 * ## THIS FILE DOES NO ARITHMETIC
 *
 * Every figure, caption, sentence and note below is a field of the adapter's
 * payload. `/m/labor` renders the same fields from the same call, so the two
 * surfaces cannot print two labour percentages for one week. The only strings
 * this file writes are chrome — the page title, the range in the subtitle, the
 * column headings, and the three chart formatters, which cannot cross the RSC
 * boundary as functions and so have to be written on this side.
 *
 * ## Four departures from the prototype, all forced by the data
 *
 * 1. **The strip is FIVE cells, not six** (L-R3). "With salaried" is dropped:
 *    `Store.fixedMonthlyLabor` is 0 and Harri's only salaried position carries
 *    $0 and 0 hours, so the cell would print the identical percentage to the
 *    one beside it. `Strip` sizes itself from `cells.length`, so this is a
 *    shorter strip, not a sixth box reading "—".
 *
 * 2. **Nothing on this page is judged against a labour floor** (L-R1). The
 *    prototype leans on a `SPLH_FLOOR = 68.00` it invented: its week strip
 *    paints `is-hit`/`is-miss` cells, its sentence names the one day "under the
 *    floor", and its twelve-week chart draws a `rule` at the top of a band.
 *    Nothing in this schema publishes an SPLH floor or a labour target, and
 *    `SplhPoint.targetSplh` is the median of the store's own history — the
 *    figure judging itself. So the week strip is `WeekStrip`, which cannot emit
 *    a verdict class at all (see its docblock), the trend `ChartSpec` carries
 *    no `rule`, and every sentence here says what a day COST rather than
 *    whether it passed. What IS judged is the schedule the store published for
 *    itself, and the copy that does it says so.
 *
 * 3. **Overtime is DOLLARS** (L-R4). There is no overtime-hours column
 *    anywhere in this schema, so the prototype's "3.5 h · one person" cannot be
 *    answered. The cell prints the premium pay and its delta says why.
 *
 * 4. **The staffing curve draws two SHAPES, not two levels.** We have people on
 *    one side and forecast ORDERS on the other, and converting between them
 *    would require a productivity standard nobody published — L-R1 again in a
 *    new costume. Both series are drawn against their own peak, the counts are
 *    in each hour's own tooltip, and the section's `meta` says so; hence
 *    `PEAK_SHARE` below rather than the prototype's `v + ' people'`.
 *
 * ## The caption-versus-delta trap
 *
 * Nothing here passes a `caption` to a `Figure`. `Figure` opens a `.band` on
 * `caption || reference`, so on the desk a caption with no reference renders an
 * EXTRA landmark, while `MCell` on the phone opens its band only inside
 * `reference ? … : ''` and renders NOTHING for the same prop. Every qualifier
 * on this page therefore rides in the delta slot, and the adapter gives each
 * one an explicit tone — an untoned `.strip .d` is `var(--good)`, which would
 * paint "premium pay · no hours column exists" green as if it were good news.
 */

/** The shapes `page.tsx` hands this island — the adapter's own, imported rather than restated. */
export type CounterLaborSections = SectionSources<LaborSections>

/** Hours on an axis. The prototype's `HRS`, at the one decimal a labour day is measured to. */
const HOURS = (v: number) => `${v.toFixed(1)} h`

/**
 * A reading on the staffing curve. Both series are already a percentage of
 * their OWN peak (see departure 4), so the unit is the only honest thing to
 * print — the absolute count for the hour is in its own tooltip.
 */
const PEAK_SHARE = (v: number) => `${Math.round(v)}% of peak`

/** A share, on a chart whose readings are already 0..100. */
const SHARE = (v: number) => pct(v, { scaled: true })

const ROLE_COLUMNS: Column[] = [
  { key: "role", label: "Role" },
  { key: "pay", label: "Pay" },
  { key: "hours", label: "Hours", numeric: true },
  { key: "cost", label: "Cost", numeric: true },
  { key: "share", label: "% of labor", numeric: true },
]

const LEAK_COLUMNS: Column[] = [
  { key: "leak", label: "Leak" },
  { key: "kind", label: "Kind" },
  { key: "alerts", label: "Alerts", numeric: true },
  { key: "hours", label: "Hours", numeric: true },
  { key: "cost", label: "Cost", numeric: true },
  { key: "people", label: "People", numeric: true },
]

/**
 * The word and the tone for a ledger row's kind.
 *
 * The page's, not the adapter's, for the reason `STAGE_TAG` is the page's on
 * the P&L: it is the rendering of a closed enum, not a judgement about data.
 * It has to be here because the table's `total` is the LEAK rows only — a
 * reader who summed the visible Hours column would get 24.94 against the
 * stated 13.47, and the column that stops that happening is this one.
 */
const KIND: Record<LeakRowView["kind"], { label: string; tone?: "good" | "warn" }> = {
  leak: { label: "leak", tone: "warn" },
  saving: { label: "saving", tone: "good" },
  uncostable: { label: "not costed" },
}

/** The verdict sentence, with the adapter's own emphasis. Same shape as the P&L's. */
function Verdict({ segments }: { segments: ReadingSegment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.strong ? <b key={i}>{s.text}</b> : <Fragment key={i}>{s.text}</Fragment>,
      )}
    </>
  )
}

/** By role, with the adapter's own total line — never a second sum of the rows. */
function roleRows(r: RolesSection): Row[] {
  const rows: Row[] = r.rows.map((row) => ({
    key: row.key,
    cells: {
      role: <b>{row.role}</b>,
      pay: <Tag>{row.payType === "SALARIED" ? "salaried" : "hourly"}</Tag>,
      hours: row.hours,
      cost: row.cost,
      share: row.share,
    },
  }))
  rows.push({
    key: "total",
    cells: {
      role: <b>Total</b>,
      pay: "",
      hours: <b>{r.total.hours}</b>,
      cost: <b>{r.total.cost}</b>,
      share: <b>{r.total.share}</b>,
    },
  })
  return rows
}

/** The leak ledger. The total is the LEAK rows only, which is what the Kind column exists to say. */
function leakRows(l: LeaksSection): Row[] {
  const rows: Row[] = l.rows.map((row) => {
    const kind = KIND[row.kind]
    return {
      key: row.key,
      cells: {
        leak: <b>{row.leak}</b>,
        kind: <Tag tone={kind.tone}>{kind.label}</Tag>,
        alerts: row.alerts,
        hours: row.hours,
        cost: row.cost,
        people: row.people,
      },
    }
  })
  rows.push({
    key: "total",
    cells: {
      leak: <b>Total</b>,
      kind: "",
      alerts: "",
      hours: <b>{l.total.hours}</b>,
      cost: <b>{l.total.cost}</b>,
      people: "",
    },
  })
  return rows
}

/** `QueueEntry` is the adapter's plain shape; `QueueItem` is the component's.
 *  `act` and `href` are inseparable in `QueueItem`'s union — a button that goes
 *  nowhere is worse than no button — so they are spread as a pair or not at all. */
function queueItems(items: QueueEntry[]): QueueItem[] {
  return items.map((i) => ({
    key: i.key,
    tone: i.tone,
    lead: i.lead,
    unit: i.unit,
    title: i.title,
    body: i.body,
    ...(i.actLabel && i.href ? { act: i.actLabel, href: i.href } : {}),
  })) as QueueItem[]
}

/** The ⌘K palette's "Ask about Labor" group. Module-level, so the shell is not
 *  republished on every render of this page. */
const ASK_SUGGESTIONS = [
  "Did we work more hours than we published?",
  "Where did the hours leak this week?",
  "When does the schedule run out?",
]

export function CounterLaborClient({
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
  sections: CounterLaborSections
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
  // The window named by its ENDS, as every other Counter page names it. NOT
  // `rangeSubtitle`, which would append the comparison's label: no section on
  // this page is drawn against a comparison window, and naming one in the
  // subtitle would promise a reading that is nowhere on the screen.
  const windowLabel = rangeLabel(range, "custom")

  return (
    /* A FRAGMENT: the rail, the topbar, the store switcher and the ⌘K surface
       belong to `(counter)/layout.tsx`. */
    <>
      <PageHead title="Labor" sub={`${storeName} · ${windowLabel}`}>
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
      <SubNav items={storeViewTabs("/dashboard/labor", counterParams.storeId, paramsString)} label="Labor" />

      {/* One figure and the verdict beside it — `.headline`, no `--duo`. Both
          halves read the same `headline` section, so a week that failed to load
          says so once in each place rather than printing half a headline. */}
      <HeadBlock
        figures={[
          <Section bare key="lead" title="Hourly labor" data={sections.headline} pending={pending}>
            {(h) => (
              <LeadFigure
                label={h.figure.label}
                value={h.figure.value}
                detail={h.figure.detail}
                // The adapter's judgement, not the arrow in the string: a
                // qualifier left unclassed paints in the colour of good news.
                detailTone={h.figure.detailTone}
              />
            )}
          </Section>,
        ]}
      >
        <Section bare title="The verdict" data={sections.headline} pending={pending}>
          {(h) => (
            <Say tone={h.verdict.tone} headline={h.verdict.headline}>
              <Verdict segments={h.verdict.body} />
            </Say>
          )}
        </Section>
      </HeadBlock>

      {/* Page level, above the first `.sec`, exactly as `strip([...])` is
          written in `P.labor.desk()`. Five cells (L-R3). */}
      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      <Section
        title="The week, day by day"
        pending={pending}
        // The adapter's: it names what the bars are scaled to, which is the
        // whole of L-R13 — a scale is not a verdict.
        meta={(w) => w.meta}
        data={sections.week}
        askAbout="how the week went day by day"
      >
        {(w) => (
          <>
            <WeekStrip days={w.days} />
            <p className="mono" style={{ margin: "10px 0 0" }}>
              {w.sentence}
            </p>
          </>
        )}
      </Section>

      <Section
        title="Scheduled against actual hours"
        pending={pending}
        meta={(s) => s.meta}
        data={sections.schedule}
        askAbout="whether we worked the hours we published"
      >
        {(s) => (
          <>
            <Chart {...s.chart} fmt={HOURS} />
            <p className="mono" style={{ margin: "9px 0 0" }}>
              {s.sentence}
            </p>
          </>
        )}
      </Section>

      <Section
        title="The staffing curve"
        pending={pending}
        meta={(c) => c.meta}
        data={sections.curve}
        askAbout="whether the schedule matches the demand curve"
      >
        {(c) => (
          <>
            <Chart {...c.chart} fmt={PEAK_SHARE} />
            <p className="mono" style={{ margin: "9px 0 0" }}>
              {c.sentence}
            </p>
          </>
        )}
      </Section>

      <div className="split">
        <Section
          title="By role"
          pending={pending}
          meta={(r) => r.meta}
          data={sections.roles}
          // `tbl()` in the prototype IS a `raw()` body — a table fills the
          // section edge to edge and must not be inset a second time.
          pad={false}
          askAbout="which roles carry the hours"
        >
          {(r) => (
            <>
              <Table columns={ROLE_COLUMNS} rows={roleRows(r)} />
              {/* NO `.sec__body` around this note. `sec__body` is a landmark
                  class and `P.labor.desk()` writes ZERO of them for this
                  section — `tbl()` returns `raw()`, so the prototype's `sec()`
                  emits the table alone. The note therefore carries the body's
                  own inset (`.sec__body{padding:13px 15px}`) inline rather than
                  opening a second landmark to get it. The P&L's "By store"
                  wraps its notes because its OWN prototype section writes two
                  `sec__body` (`counter-prototype.html:5327`); this one does not.
                  Only when there is something to say. */}
              {r.note ? (
                <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
                  {r.note}
                </p>
              ) : null}
            </>
          )}
        </Section>

        <Section
          title="Where the hours leaked"
          pending={pending}
          meta={(l) => l.meta}
          data={sections.leaks}
          pad={false}
          askAbout="where the hours leaked"
        >
          {(l) => (
            <>
              <Table columns={LEAK_COLUMNS} rows={leakRows(l)} />
              {/* Unwrapped, for the reason the role note above is unwrapped. */}
              <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
                {l.note}
              </p>
            </>
          )}
        </Section>
      </div>

      <Section
        title="Needs a decision"
        pending={pending}
        meta={(d) => d.meta}
        data={sections.decision}
        askAbout="what needs deciding about the schedule"
      >
        {(d) => (
          <>
            {/* ONE item for the whole uncovered stretch, not one per day
                (L-R8): publishing a schedule for it is a single action, and
                `.qitem` is a landmark the prototype writes exactly one of. */}
            <Queue items={queueItems(d.items)} />
            <p className="mono" style={{ margin: "10px 0 0" }}>
              {d.note}
            </p>
          </>
        )}
      </Section>

      <Section
        title="Twelve weeks"
        pending={pending}
        meta={(t) => t.meta}
        data={sections.trend}
        askAbout="the twelve-week labor trend"
      >
        {(t) => (
          <>
            {/* No `rule` and no band (L-R10): the prototype draws a 23.9–26.2%
                band it invented, and a line drawn here would be one this page
                then graded twelve weeks against. */}
            <Chart {...t.chart} fmt={SHARE} />
            <p className="mono" style={{ margin: "9px 0 0" }}>
              {t.sentence} {t.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
