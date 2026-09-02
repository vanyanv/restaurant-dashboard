"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  DateControl,
  Note,
  PageHead,
  Queue,
  Section,
  Strip,
  Table,
  Tag,
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
import type {
  LaborWeekTable,
  RolesSection,
  StoreLaborSections,
} from "@/lib/counter/adapters/labor"
import type { QueueEntry } from "@/lib/counter/adapters/overview"

/**
 * One store's Labor on the desk, composed from `P.laborstore.desk()`
 * (`docs/counter/counter-prototype.html:7671`) in the prototype's own order:
 *
 *   the store note → the strip of four → scheduled against actual →
 *   a `.split` of by-role and the leak ledger → the week day by day →
 *   twelve weeks.
 *
 * A page composes primitives and calls exactly one adapter; it never imports
 * Prisma or an action directly and never inspects `SectionData.status`.
 * `Section` is the sole state renderer, `bare` for the note and the strip,
 * which are not a `.sec` here.
 *
 * ## THIS FILE DOES NO ARITHMETIC
 *
 * Every figure, sentence, caption and verdict below is a field of the
 * adapter's payload — including the week table's last column, which is a
 * pre-formatted string and a `TagTone` the adapter decided. `/m/labor/[…]`
 * renders the same fields from the same call, so the two surfaces cannot print
 * two labour percentages for one week. The only strings this file writes are
 * chrome: the page title, the range in the subtitle, the column headings, and
 * the two chart formatters, which cannot cross the RSC boundary as functions
 * and so have to be written on this side.
 *
 * ## Four departures from the prototype, all forced by the data
 *
 * 1. **The week table's verdict column does not compare against a floor**
 *    (L-R1). `P.laborstore.desk()` prints `sp >= SPLH_FLOOR ? 'Paid for
 *    itself' : 'Under the floor'` against a `SPLH_FLOOR = 68.00` it invented.
 *    Nothing in this schema publishes a sales-per-labour-hour floor or a
 *    labour target — `adapters/overview.ts:343` ruled it, because the only
 *    candidate is the median of the store's own history, which is the figure
 *    judging itself. So the column says what the day COST against the shifts
 *    this store published for it, in dollars, and the section's own note says
 *    out loud what it is read against and what it is not. A day inside the
 *    shared `scheduleHeld()` tolerance reads "on the published schedule"
 *    rather than a dollar figure, which is the group verdict's tolerance and
 *    the schedule sentence's, not a second one invented here.
 *
 * 2. **The leak ledger is a QUEUE here, not the group page's table.** That is
 *    the prototype's own shape for this route, and it is the right one: half a
 *    `.split` cannot carry six numeric columns, and a reader on one store's
 *    page is looking at the two codes they can act on rather than at the whole
 *    ledger. The queue is `leaks.items`, which the adapter builds from the
 *    LEAK rows only — savings and the uncostable codes are not in it, and the
 *    note under it is what says so.
 *
 * 3. **The role table's Pay column stays.** The prototype has four columns
 *    (Role · Hours · Cost · Share); this keeps the group page's five, because
 *    Harri's one salaried position carries $0 and 0 hours here and a reader
 *    who could not see that it is salaried would read that row as a mistake.
 *
 * 4. **There is no staffing curve and no "needs a decision" on this route.**
 *    `StoreLaborSections` has six members and neither is one of them: both are
 *    about the schedule that has not been worked yet, both are already whole
 *    on the group page, and neither is per-store data this route could say
 *    anything new about.
 *
 * ## The caption-versus-delta trap
 *
 * Nothing here passes a `caption` to a `Figure`. `Figure` opens a `.band` on
 * `caption || reference`, so on the desk a caption with no reference renders
 * an EXTRA landmark, while `MCell` on the phone opens its band only inside
 * `reference ? … : ''` and renders NOTHING for the same prop. Every qualifier
 * in this page's strip therefore rides in the delta slot, and the adapter
 * gives each one an explicit tone — an untoned `.strip .d` is `var(--good)`,
 * which would paint "of Total Sales" green as if it were good news.
 */

/** The shapes `page.tsx` hands this island — the adapter's own, imported rather than restated. */
export type CounterStoreLaborSections = SectionSources<StoreLaborSections>

/** Hours on an axis. The prototype's `HRS`, at the one decimal a labour day is measured to. */
const HOURS = (v: number) => `${v.toFixed(1)} h`

/** A share, on a chart whose readings are already 0..100. */
const SHARE = (v: number) => pct(v, { scaled: true })

/** The group page's five, not the prototype's four — see departure 3. */
const ROLE_COLUMNS: Column[] = [
  { key: "role", label: "Role" },
  { key: "pay", label: "Pay" },
  { key: "hours", label: "Hours", numeric: true },
  { key: "cost", label: "Cost", numeric: true },
  { key: "share", label: "% of labor", numeric: true },
]

/**
 * The week, day by day.
 *
 * "Sales" and not the prototype's "Net": the column is this day's Total Sales
 * off the statement, which is the denominator of the Labor % beside it (L-R2).
 * Calling it Net would name the one figure on the row it is not.
 */
const WEEK_COLUMNS: Column[] = [
  { key: "day", label: "Day" },
  { key: "sales", label: "Sales", numeric: true },
  { key: "hours", label: "Hours", numeric: true },
  { key: "splh", label: "SPLH", numeric: true },
  { key: "laborPct", label: "Labor %", numeric: true },
  { key: "verdict", label: "Against the schedule" },
]

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

/**
 * The week table.
 *
 * The last cell is a `Tag` only when the adapter gave it a tone — a day that
 * held its schedule, or one that published none, is a plain sentence rather
 * than a pill, because a pill on every row turns the column into a verdict
 * badge and the two untoned readings are not verdicts.
 */
function weekRows(w: LaborWeekTable): Row[] {
  return w.rows.map((row) => ({
    key: row.key,
    cells: {
      day: <b>{row.day}</b>,
      sales: row.sales,
      hours: row.hours,
      splh: row.splh,
      laborPct: row.laborPct,
      verdict: row.verdictTone ? <Tag tone={row.verdictTone}>{row.verdict}</Tag> : row.verdict,
    },
  }))
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

/** The ⌘K palette's "Ask about Labor" group — this route's own three questions. */
const ASK_SUGGESTIONS = [
  "Which day this week cost the most against its schedule?",
  "Where did the hours leak at this store?",
  "Which roles carry the hours here?",
]

export function CounterStoreLaborClient({
  params: paramsString,
  storeId,
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
  /** The PATH's store — what scopes this page. There is no `?store=` here. */
  storeId: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterStoreLaborSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  const store = stores.find((s) => s.id === storeId) ?? null
  // `page.tsx` 404s on a store the switcher does not list, so this fallback is
  // for a store list that failed to load rather than for a wrong id.
  const storeName = store?.name ?? "This store"

  // The store is published upward because the URL cannot say it: the rail
  // reads `?store=` and there is none on this route, so without this the
  // switcher would show "All stores" on a page about one.
  usePageChrome({
    leaf: storeName,
    storeId,
    storeName,
    askSuggestions: ASK_SUGGESTIONS,
  })

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
  // The window named by its ENDS. NOT `rangeSubtitle`, which would append the
  // comparison's label: no section on this page is drawn against a comparison
  // window, and naming one in the subtitle would promise a reading that is
  // nowhere on the screen.
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

      {/* The same `VIEWS` pair as the group page, so the bar works in both
          directions. The store here is the PATH's, which is the one this page
          is about. */}
      <SubNav items={storeViewTabs("/dashboard/labor", storeId, paramsString)} label="Labor" />

      {/* The prototype's `storeNote()` and its strip, in one block above the
          first `.sec`. The note is the adapter's — it states what this route
          adds to the group page, and it is one sentence rather than a second
          page-level heading. Four cells (`buildStoreStrip`): the group's first
          three and the leak as one, with Overtime dropped. */}
      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => (
          <>
            <Note lede>
              {h.note}
            </Note>
            <Strip cells={h.cells} />
          </>
        )}
      </Section>

      <Section
        title="Scheduled against actual"
        pending={pending}
        meta={(s) => s.meta}
        data={sections.schedule}
        askAbout="whether this store worked the hours it published"
      >
        {(s) => (
          <>
            <Chart {...s.chart} fmt={HOURS} />
            <Note>
              {s.sentence}
            </Note>
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
          askAbout="which roles carry the hours here"
        >
          {(r) => (
            <>
              <Table columns={ROLE_COLUMNS} rows={roleRows(r)} />
              {/* NO `.sec__body` around this note, for the reason the group
                  page states: `tbl()` returns `raw()`, so the prototype's
                  `sec()` emits the table alone and there is no body landmark
                  to reopen. The note carries the body's own inset
                  (`.sec__body{padding:13px 15px}`) inline instead, and only
                  when there is something to say. */}
              {r.note ? (
                <Note flush>
                  {r.note}
                </Note>
              ) : null}
            </>
          )}
        </Section>

        <Section
          title="Where the hours leaked"
          pending={pending}
          meta={(l) => l.meta}
          data={sections.leaks}
          askAbout="where the hours leaked at this store"
        >
          {(l) => (
            <>
              {/* The LEAK codes only (departure 2). A range whose only alerts
                  were savings or uncostable codes has an empty worklist and no
                  `.queue` at all — the note below is then the whole reading,
                  and it is the sentence that explains why. */}
              {l.items.length > 0 ? <Queue items={queueItems(l.items)} /> : null}
              <Note bare={l.items.length === 0}>{l.note}</Note>
            </>
          )}
        </Section>
      </div>

      {/* The section the group page cannot draw once per store. */}
      <Section
        title="The week, day by day"
        pending={pending}
        meta={(w) => w.meta}
        data={sections.week}
        pad={false}
        askAbout="how each day went against its schedule"
      >
        {(w) => (
          <>
            <Table columns={WEEK_COLUMNS} rows={weekRows(w)} />
            {/* Unwrapped, for the reason the role note above is unwrapped. This
                is the note that says the last column is read against this
                store's own published shifts and against no floor (L-R1). */}
            <Note flush>
              {w.note}
            </Note>
          </>
        )}
      </Section>

      <Section
        title="Twelve weeks"
        pending={pending}
        meta={(t) => t.meta}
        data={sections.trend}
        askAbout="the twelve-week labor trend at this store"
      >
        {(t) => (
          <>
            {/* No `rule` and no band (L-R10): the prototype draws a 23.9–26.2%
                band it invented, and a line drawn here would be one this page
                then graded twelve weeks against. */}
            <Chart {...t.chart} fmt={SHARE} />
            <Note>
              {t.sentence} {t.note}
            </Note>
          </>
        )}
      </Section>
    </>
  )
}
