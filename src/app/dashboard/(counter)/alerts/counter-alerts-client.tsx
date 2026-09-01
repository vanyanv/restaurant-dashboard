"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  Filters,
  PageHead,
  Section,
  StatusPill,
  Strip,
  Table,
  Tag,
  Toggles,
  useCounterTransition,
  usePageChrome,
  type Column,
  type FigureProps,
  type Row,
  SubNav,
} from "@/components/counter"
import { ALERT_TABS } from "@/lib/counter/nav"
import { ALERT_SEGMENTS, type AlertSegment } from "@/lib/counter/alert-filters"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import type {
  AlertsFilters,
  AlertStripCell,
  AlertsRow,
  AlertsSections,
} from "@/lib/counter/adapters/alerts"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { AlertSeverity, AlertSource } from "@/generated/prisma/client"

/**
 * Counter Needs-you — "Open right now", the desk surface (`P.alerts.desk`,
 * `docs/counter/counter-prototype.html:4775`), composed in the prototype's own
 * order:
 *
 *   strip([...four cells])                         page level, above any .sec
 *   <div class="sec">                              a .sec with NO .sec__head
 *     .filters   — search + three severity toggles + the count
 *     .filters   — a `Source` caption + five source toggles
 *     tbl(...)   — severity, alert, source, opened, status
 *   </div>
 *   sec('Alerts opened', <window>, chart(bars))
 *
 * A page composes primitives and never inspects a `SectionData.status`;
 * `Section` is the sole state renderer, `bare` for the blocks that are not a
 * `.sec__head`-bearing section here.
 *
 * ## The four figures in the strip, and why three of them do not say what the
 * prototype says
 *
 * The prototype's cells read "Acknowledged 12", "Muted 2 · by rule" and
 * "Median time to close 1.4 days ▼ 0.6 on last month". Live, they read
 * `Acknowledged 0 · none yet`, `Muted 0 · no rules set` and
 * `Median time to close 1.8 h · over dismissals`, with no delta on any of
 * them. The whole of that decision is in `adapters/alerts.ts` — rulings N-R1
 * through N-R3 — and none of it is re-decided here: this file receives four
 * `AlertStripCell`s and turns them into four `Figure`s.
 *
 * `AlertStripCell.delta` and `.note` become ONE rendered element, because
 * `Figure` has exactly one slot between the value and the band (`.d`) and
 * `.band` needs a `reference` this page has none of. `delta` wins when there
 * is one; today there never is, so every cell prints its note. That is also
 * the prototype's own arrangement — it puts "2 need a decision" and "by rule"
 * in the same slot as "▼ 0.6 on last month".
 *
 * ## Two filter rows, both writing to the URL
 *
 * The first is `Filters`, the same component the orders list uses. The second
 * is the prototype's source row: a `.mono` caption and five bare-word
 * toggles, with no search box, no clear and no count — so it is composed here
 * from `Toggles` rather than from a second `Filters` that would emit three
 * landmarks this row does not have.
 *
 * All five source toggles render whatever the data holds, and the four with no
 * rows render disabled and saying `0` (N-R1). Four of the five have never
 * fired on this account; a row that quietly showed one toggle would make a
 * claim about what this product can alert on rather than about today's rows.
 *
 * ## What this page does NOT have
 *
 * - **A date control.** `P.alerts` carries no `nodate`, so the prototype draws
 *   `CD.bar()` here — but `getAlertInbox` is scoped to the anomaly RELEVANCE
 *   HORIZON, not to a window a reader picks, and every count in the strip is
 *   horizon-scoped with it. A control that moved a range the figures do not
 *   read is markup that looks wired and is not (note 46). The window is named
 *   in the sub-line instead, where a reader can see it.
 * - **A destination on a row.** The prototype's `tbl` maps each source to a
 *   page; ours has no per-alert page and no per-source page that is on Counter
 *   yet, so the rows are inert. `Table` gives `data-goto` — and with it the
 *   cursor, the hover wash and the chevron — only to a row that carries an
 *   `href`, so an inert row cannot advertise a click that does nothing.
 * - **An `.empty` state, in any segment.** See the adapter's note on `table`.
 */
export type CounterAlertsSections = SectionSources<AlertsSections>

/** See `counter-orders-client.tsx` — the box holds the keystrokes, the URL
 *  holds the filter, and this is how long the first waits to become the second. */
const SEARCH_SETTLE_MS = 300

const COLUMNS: Column[] = [
  { key: "severity", label: "Severity" },
  { key: "alert", label: "Alert" },
  { key: "source", label: "Source" },
  { key: "opened", label: "Opened" },
  { key: "status", label: "Status" },
]

/** The prototype's `v + ' opened'` (line 4810). Counts, not currency. */
const openedCount = (v: number) => `${v} opened`

/**
 * One `AlertStripCell` as a `Figure`. `delta` beats `note`, and a note is
 * always flat — it is a qualifier, not a movement.
 */
function figureOf(c: AlertStripCell): FigureProps {
  return {
    label: c.label,
    value: c.value,
    delta: c.delta ?? c.note,
    deltaTone: c.delta === null ? (c.deltaTone ?? "is-flat") : c.deltaTone,
  }
}

function alertRows(rows: AlertsRow[]): Row[] {
  return rows.map((r) => ({
    key: r.key,
    cells: {
      // The class map (CRITICAL wears `REJECTED`, WATCH wears `REVIEW`) lives
      // in `StatusPill` and nowhere else.
      severity: <StatusPill severity={r.severity} />,
      // `body` is null on every live row, and an absent second line is the
      // honest rendering of that — never an empty `<span>`.
      alert: r.body ? (
        <>
          <b>{r.title}</b>
          <span> {r.body}</span>
        </>
      ) : (
        r.title
      ),
      source: r.sourceLabel,
      opened: r.opened,
      status: <Tag tone={r.statusTone}>{r.statusLabel}</Tag>,
    },
  }))
}

const ASK_SUGGESTIONS = [
  "What is open right now that I have not looked at?",
  "How long does it take me to close an alert?",
  "Which store is raising the most alerts?",
]

export function CounterAlertsClient({
  params: paramsString,
  storeName,
  today,
  sections,
}: {
  /** The query string as PLAIN TEXT — a `URLSearchParams` loses its prototype crossing the RSC boundary. */
  params: string
  storeName: string
  today: Date
  sections: CounterAlertsSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  usePageChrome({ askSuggestions: ASK_SUGGESTIONS })

  const { pending, startTransition } = useCounterTransition()

  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelSettle = useCallback(() => {
    if (settleRef.current !== null) {
      clearTimeout(settleRef.current)
      settleRef.current = null
    }
  }, [])

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

  const { search, segment, severities, sources } = counterParams

  const [draft, setDraft] = useState(search)
  const draftRef = useRef(draft)
  draftRef.current = draft

  /*
   * What we believe the URL's `q` is — NOT the same as `search`.
   *
   * Read the note above `committed` in `counter-orders-client.tsx` before
   * touching any of this. `search` is the URL as it was when this render
   * began and a `router.push` does not land synchronously, so comparing the
   * draft against `search` re-arms the settle on the PRE-CLEAR params
   * immediately after Clear and puts the cleared filters straight back 300ms
   * later. Comparing against what was last COMMITTED closes that window.
   */
  const [committed, setCommitted] = useState(search)
  const [seeded, setSeeded] = useState(search)
  if (seeded !== search) {
    setSeeded(search)
    setDraft(search)
    setCommitted(search)
  }

  useEffect(() => {
    if (draft.trim() === committed) return
    settleRef.current = setTimeout(() => {
      settleRef.current = null
      setCommitted(draft.trim())
      push({ search: draft })
    }, SEARCH_SETTLE_MS)
    return cancelSettle
  }, [draft, committed, push, cancelSettle])

  /**
   * Toggling either row carries the half-typed word WITH it, for the same
   * reason the orders list does: without it, pressing a toggle throws away
   * what the reader was in the middle of typing.
   */
  const carrySearch = useCallback(() => {
    const carry = draftRef.current.trim()
    setCommitted(carry)
    return carry === search ? {} : { search: carry }
  }, [search])

  const onSeverity = useCallback(
    (id: string) => {
      const pressed = new Set<AlertSeverity>(severities)
      if (pressed.has(id as AlertSeverity)) pressed.delete(id as AlertSeverity)
      else pressed.add(id as AlertSeverity)
      const carry = carrySearch()
      // Canonical order rather than press order, so two readers who pressed
      // the same two toggles end up holding the same link.
      push({
        severities: (["CRITICAL", "WATCH", "INFO"] as AlertSeverity[]).filter((s) =>
          pressed.has(s),
        ),
        ...carry,
      })
    },
    [severities, push, carrySearch],
  )

  const onSource = useCallback(
    (id: string) => {
      const pressed = new Set<AlertSource>(sources)
      if (pressed.has(id as AlertSource)) pressed.delete(id as AlertSource)
      else pressed.add(id as AlertSource)
      const carry = carrySearch()
      push({
        sources: (
          [
            "ANOMALY_EVENT",
            "PRICE_DELTA",
            "HARRI_VARIANCE",
            "QUANTITY_SPIKE",
            "NEW_PRODUCT",
          ] as AlertSource[]
        ).filter((s) => pressed.has(s)),
        ...carry,
      })
    },
    [sources, push, carrySearch],
  )

  /*
   * Clear deselects EVERY toggle and empties the box. It never selects all of
   * them — no toggle pressed is no filter at all, and all of them pressed is
   * an `IN (…)` that would drop a row whose severity or source is outside the
   * list. A Clear that narrows the list is the worst possible reading of the
   * word. The SEGMENT is deliberately left alone: it is a view, not a filter.
   */
  const onClear = useCallback(() => {
    setDraft("")
    setCommitted("")
    push({ severities: [], sources: [], search: "" })
  }, [push])

  return (
    <>
      <PageHead
        // `P.alerts.title`. The page's name is in the breadcrumb.
        title="Open right now"
        // The window is NAMED because there is no control to change it — see
        // the file note on the missing date bar.
        sub={`${storeName} · last 30 days`}
      >
        {/* `P.alerts.seg` — `['Open','All','Muted']`, in the URL so a segment
            survives a reload and travels in a link. */}
        <div className="seg">
          {ALERT_SEGMENTS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={segment === s.id}
              onClick={() => push({ segment: s.id as AlertSegment })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </PageHead>

      {/* The design's `VIEWS` bar for this family — see `ALERT_TABS` in
          `@/lib/counter/nav`. Without it these siblings are pages nothing
          links to; `.seg` is not a fidelity landmark, so it changes no count. */}
      <SubNav items={ALERT_TABS} label="Alerts" />

      <Section bare title="The figures" data={sections.strip} pending={pending}>
        {(cells) => <Strip cells={cells.map(figureOf)} />}
      </Section>

      {/* The prototype's own headless `.sec` — no `.sec__head`, because the
          page title and the filter bar's count already say what a heading
          would, and `.sec__head` is a landmark the fidelity gate counts. */}
      <div className="sec">
        <Section bare title="Filters" data={sections.filters} pending={pending}>
          {(f) => (
            <AlertFilterRows
              filters={f}
              draft={draft}
              onSearch={setDraft}
              onSeverity={onSeverity}
              onSource={onSource}
              onClear={f.filtering ? onClear : undefined}
            />
          )}
        </Section>
        <Section bare title="Alerts" data={sections.table} pending={pending}>
          {(rows) => <Table columns={COLUMNS} rows={alertRows(rows)} />}
        </Section>
      </div>

      <Section
        title="Alerts opened"
        // The window the bars actually cover, named by the ADAPTER — a fact
        // about the data, not a page decision.
        meta={(c) => c.meta}
        data={sections.chart}
        pending={pending}
      >
        {(c) => (
          <Chart
            type="bars"
            h={124}
            zero
            labels={c.labels}
            series={c.series}
            // `fmt` defaults to `money()`. Unpassed, a day that opened three
            // alerts would read "$3".
            fmt={openedCount}
            alt={c.alt}
          />
        )}
      </Section>
    </>
  )
}

/** The two `.filters` rows, in the prototype's order. */
function AlertFilterRows({
  filters,
  draft,
  onSearch,
  onSeverity,
  onSource,
  onClear,
}: {
  filters: AlertsFilters
  draft: string
  onSearch: (next: string) => void
  onSeverity: (id: string) => void
  onSource: (id: string) => void
  onClear?: () => void
}) {
  return (
    <>
      <Filters
        search={draft}
        // The prototype's own placeholder and label, at line 4780.
        searchPlaceholder="Search alerts"
        searchLabel="Search alerts"
        onSearch={onSearch}
        toggles={filters.severities}
        onToggle={onSeverity}
        onClear={onClear}
        count={filters.count}
      />
      {/*
       * `style="border-top:0"` is the prototype's own (line 4788). It is inert
       * against the ported sheet — `.filters` carries a border-BOTTOM and no
       * border-top — and `counter-components.css` has no class for it, so the
       * prototype's inline style is transcribed rather than invented around.
       * It is a layout property, which `npm run tokens` permits; the colour
       * rule matches hex/oklch/rgb/hsl literals only.
       */}
      <div className="filters" style={{ borderTop: 0 }}>
        <span className="mono" style={{ letterSpacing: ".14em", textTransform: "uppercase" }}>
          Source
        </span>
        <Toggles toggles={filters.sources} onToggle={onSource} />
      </div>
    </>
  )
}
