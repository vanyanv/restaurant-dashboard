"use client"

import { Fragment, useCallback, useMemo, useState, useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Briefing,
  Dots,
  HeadBlock,
  LeadFigure,
  MathLines,
  Note,
  PageHead,
  Queue,
  Record,
  Say,
  Section,
  Strip,
  Table,
  Tag,
  WeekPicker,
  useCounterTransition,
  usePageChrome,
  type Column,
  type QueueItem,
  type Row,
  type SwitchableStore,
  SubNav,
} from "@/components/counter"
import { ALERT_TABS } from "@/lib/counter/nav"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { weekDayLabel, weekLabel } from "@/lib/counter/week-window"
import type { DecisionQueueItem, DecisionsSections, LedgerRow } from "@/lib/counter/adapters/decisions"
import type { SectionSources } from "@/lib/counter/adapters/types"
import { recordDecision } from "@/lib/counter/actions/decision"
import type { ReadingSegment } from "@/lib/counter/adapters/pnl"

/**
 * Counter Needs-you — the desk, composed from `P.decisions.desk()`
 * (`docs/counter/counter-prototype.html:4682`) in the prototype's own order:
 *
 *   headBlock(.headline: .fig + .say)            page level, above any .sec
 *   strip([...four cells])                       page level
 *   sec('The briefing', 'what the week turns on', briefline × n)
 *   sec('The call this week', 'forecast against actual · click a day', .wk + p.mono)
 *   <div class="split"> sec('<day> in detail') sec('How well we have been calling it') </div>
 *   <div class="split"> sec('What you decided')  sec('What to do this week')          </div>
 *
 * A page composes primitives and calls exactly one adapter; it never imports
 * Prisma or an action directly and never inspects `SectionData.status` —
 * `npm run tokens` fails the build on either, and on an `AppShell` mounted
 * here. `Section` is the sole state renderer, `bare` for the two page-level
 * blocks that are not a `.sec`.
 *
 * ## The day picker writes to the URL, not to component state
 *
 * Same rule as every other Counter control. `?day=2026-08-29` survives a
 * reload, travels in a link, and — the part that matters here — is the same
 * key `/m/decisions` reads, so a day pressed on the desk opens on the same
 * day on a phone. The SERVER then builds the detail panel for that day, which
 * is why the panel and the picker cannot disagree about which day is selected.
 *
 * `weekDayLabel` is imported rather than read off `sections.day`, and that is
 * not a shortcut: the section's title has to be on screen while the section is
 * still loading (`Section` renders its head in every state), so the label
 * cannot come from the data the head is waiting for. It is the same function
 * the adapter labels the picker's cells with — see `@/lib/counter/week-window`.
 *
 * ## What the prototype has here and this page does not
 *
 * - **"Add three shifts" / "Leave it" under the Saturday panel.** Two buttons
 *   the prototype wires to nothing, on the one hard-coded day of its literal
 *   week. Publishing a shift is a write this page has no action for, and a
 *   button that does nothing is worse than no button (the rule `Queue`'s own
 *   type enforces).
 * - **"Worth, per day" on the scorecard.** `MlForecastEvaluation` publishes
 *   coverage, WAPE and a baseline delta; the dollar value of being right is
 *   not among them, and deriving one here would be this page inventing a
 *   figure the evaluator never measured.
 * - **A "Commit" button on each queue item.** `QueueItem` refuses an `act`
 *   without a handler or a destination; an adapter is a server module and has
 *   no handler to give, so each item links to the page where the work is
 *   actually done. See the adapter's `ACTION_ROUTE`.
 * - **Four ledger rows.** `DecisionLog` holds zero rows in production, so the
 *   table renders its four column headers over no rows — never `Empty`, which
 *   would emit a `.empty` landmark this page's prototype does not have
 *   (ruling N-R5).
 */
export type CounterDecisionsSections = SectionSources<DecisionsSections>

const LEDGER_COLUMNS: Column[] = [
  { key: "date", label: "Date" },
  { key: "decision", label: "Decision" },
  { key: "worth", label: "Worth", numeric: true },
  { key: "outcome", label: "Outcome" },
]

/** The ⌘K palette's "Ask about the week" group. Module-level, so the shell is
 *  not republished on every render of this page. */
const ASK_SUGGESTIONS = [
  "What is the one thing that needs me this week?",
  "How well has the forecast been calling it?",
  "Which day is short on cover?",
]

function ledgerRows(rows: LedgerRow[]): Row[] {
  return rows.map((r) => ({
    key: r.key,
    cells: {
      date: r.date,
      decision: r.decision,
      worth: r.worth,
      // `.mtag` — the prototype's own Holding / Held / Reversed / Watching.
      // The tone is the adapter's judgement about the outcome, never a
      // comparison made here.
      outcome: <Tag tone={r.outcomeTone}>{r.outcome}</Tag>,
    },
  }))
}

/**
 * The prototype's queue body: the claim, the confidence meter, the confidence
 * in words, and the deadline in bold.
 *
 * `.dots` beside prose rather than instead of it — colour and a four-slot
 * meter are the same claim said twice, and only one of them survives a
 * screen reader. The adapter carries all four pieces (`why`, `dots`,
 * `confidence`, `note`); this function is only their arrangement.
 */
/**
 * DID YOU DO IT — the half of this page that has never existed.
 *
 * Every item in the queue already carries a `.do` button, and every one of
 * them NAVIGATES: "Open Pricing", "Open Menu mix". The page points at work and
 * then never hears back about it. That is why `DecisionLog` holds zero rows in
 * production, and why the accuracy panel three sections up this same page —
 * built to score committed calls against a frozen counterfactual — has never
 * had a single call to score. It is not that the owner decides nothing. It is
 * that nothing has ever asked.
 *
 * Two verbs, and like the alert inbox's pair they are not interchangeable:
 *
 *   - **I did this** commits, and freezes the forecast alongside the row,
 *     because the counterfactual worth measuring is the one from the moment
 *     the owner acted, not the one from whenever someone next looks.
 *   - **Skip** dismisses and freezes nothing, because there is no effect to
 *     measure. It still records, which matters: an owner who skips every
 *     menu-engineering card for two months is telling the ranker something no
 *     accuracy metric can see.
 *
 * The write keys on `ref.title`, the generator's own string, never the
 * jargon-stripped one the reader sees above it. See `DecisionQueueItem.ref`.
 */
function QueueDecision({ item }: { item: DecisionQueueItem }) {
  const router = useRouter()
  const [saving, startSaving] = useTransition()
  const [failed, setFailed] = useState(false)

  const record = (outcome: "commit" | "dismiss") => {
    setFailed(false)
    startSaving(async () => {
      const result = await recordDecision(
        {
          storeId: item.ref.storeId,
          opportunityType: item.ref.type,
          opportunityTitle: item.ref.title,
          opportunityAsOf: item.ref.asOf,
          predictedImpactUsdPerWeek: item.ref.impactUsdPerWeek,
          predictedImpactP10: item.ref.p10,
          predictedImpactP90: item.ref.p90,
        },
        outcome,
      )
      if (!result.ok) {
        setFailed(true)
        return
      }
      // The ledger, the accuracy panel and this queue all read `DecisionLog`.
      // Refresh so the row the owner just wrote appears in all three.
      router.refresh()
    })
  }

  /*
   * `.do`, not `.btn`.
   *
   * `.do` is the class the prototype gives a queue item's action — `act:
   * 'Commit'` on all three of `P.decisions`' items — and `.qitem .do` is the
   * only rule in `counter-components.css` written for a control in this
   * position. `.btn` is the page-level button, it draws a bordered chip that
   * does not belong inside a `.qitem`, and it is a landmark the fidelity gate
   * counts: two of them per item would put a data-dependent count on a page
   * whose allowances have to name an exact one. Both reasons point the same
   * way, which is usually the sign the design was right the first time.
   */
  return (
    <>
      <button
        className="do"
        type="button"
        style={{ marginLeft: 13 }}
        disabled={saving}
        onClick={() => record("commit")}
      >
        {saving ? "…" : "I did this"}
      </button>
      <button
        className="do"
        type="button"
        style={{ marginLeft: 13 }}
        disabled={saving}
        onClick={() => record("dismiss")}
      >
        Skip
      </button>
      {failed ? <span className="k"> did not save</span> : null}
    </>
  )
}

function queueItems(items: DecisionQueueItem[]): QueueItem[] {
  return items.map((i) => ({
    key: i.key,
    tone: i.tone,
    lead: i.lead,
    unit: i.unit,
    title: i.title,
    body: (
      <>
        {i.why} <Dots filled={i.dots} /> {i.confidence} · <b>{i.note}</b>
      </>
    ),
    act: i.act,
    href: i.href,
    decide: <QueueDecision item={i} />,
  })) as QueueItem[]
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

export function CounterDecisionsClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  /**
   * The query string this page was rendered for, as PLAIN TEXT — not a
   * `URLSearchParams` instance. Props cross the RSC boundary as plain
   * serialisable values only; a `URLSearchParams` arrives on the client with
   * its prototype stripped.
   */
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterDecisionsSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  // `leaf` explicitly, the same reason Product mix passes one: this page has no
  // rail entry of its own, so `owningDestination` finds nothing and the trail
  // rendered as the store followed by a bare separator and no page name. The
  // label is the `PageHead` title below, so the crumb and the heading agree.
  usePageChrome({ leaf: "The week ahead", askSuggestions: ASK_SUGGESTIONS })

  /*
   * The ONE transition shared with `AppShell`'s own store switcher — see
   * `counter-transition.tsx`. `pending` is threaded to every `<Section>`
   * below and `startTransition` wraps this page's own `push`, so a store
   * change from the rail and a day pressed here mark the same `stale`.
   */
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

  const selectedStore = stores.find((s) => s.id === counterParams.storeId) ?? null
  const storeName = selectedStore?.name ?? "All stores"
  // The week the picker draws, named by its ends. `today` came from the
  // server, which is also where the adapter's `asOf` came from, so the sub
  // and the seven cells cannot name two different weeks.
  const window = weekLabel(today)
  // Today when nothing has been pressed — the adapter's own fallback, said
  // here so the picker's `is-sel` cell and the panel below it agree before
  // either has loaded.
  const selectedDay = counterParams.day ?? today.toISOString().slice(0, 10)

  return (
    /*
     * A FRAGMENT: the rail, the topbar, the store switcher and the ⌘K surface
     * are `(counter)/layout.tsx`'s.
     */
    <>
      <PageHead
        // `P.decisions.title` — the page's NAME. There is no date control
        // here: the week is not a window a reader picks, it is the week.
        title="The week ahead"
        sub={`${storeName} · ${window}`}
      />

      {/* The design's `VIEWS` bar for this family — see `ALERT_TABS` in
          `@/lib/counter/nav`. Without it these siblings are pages nothing
          links to; `.seg` is not a fidelity landmark, so it changes no count. */}
      <SubNav items={ALERT_TABS} label="Alerts" />

      {/* One figure and the verdict beside it — `.headline`, no `--duo`.
          Both halves read the same `head` section, so a week that failed to
          load says so once in each place rather than printing half a
          headline. */}
      <HeadBlock
        figures={[
          <Section bare key="pot" title="The call this week" data={sections.head} pending={pending}>
            {(h) => (
              <LeadFigure
                label={h.figure.label}
                value={h.figure.value}
                detail={h.figure.detail}
                // The adapter's judgement, not the arrow in the string: a
                // fall left unclassed paints in the colour of a rise.
                detailTone={h.figure.detailTone}
              />
            )}
          </Section>,
        ]}
      >
        <Section bare title="The verdict" data={sections.head} pending={pending}>
          {(h) => (
            <Say tone={h.verdict.tone} headline={h.verdict.headline} action={h.verdict.action ?? undefined}>
              <Verdict segments={h.verdict.body} />
            </Say>
          )}
        </Section>
      </HeadBlock>

      {/* Page level, above the first `.sec`, exactly as `strip([...])` is
          written in `P.decisions.desk()`. */}
      <Section bare title="The figures" data={sections.strip} pending={pending}>
        {(cells) => <Strip cells={cells} />}
      </Section>

      <Section
        title="The briefing"
        meta="what the week turns on"
        data={sections.briefing}
        pending={pending}
        askAbout="what the week turns on"
      >
        {(lines) => <Briefing lines={lines} />}
      </Section>

      <Section
        title="The call this week"
        meta="forecast against actual · click a day"
        data={sections.week}
        pending={pending}
      >
        {(days) => (
          <>
            <WeekPicker
              days={days}
              selected={selectedDay}
              // To the URL, never to state. See the file note.
              onSelect={(key) => push({ day: key })}
            />
            {/* The prototype's own closing line under the picker. It states
                what the marks mean, which nothing else on the page does: a
                cell is a hit at 97% of the call, and a day still ahead is
                neither. */}
            <Note>
              A day is marked once it has closed and reconciled &mdash; inside 3% of the call is a
              hit. A day still ahead carries its forecast and no mark.
            </Note>
          </>
        )}
      </Section>

      <div className="split">
        <Section
          // The day's own name, from the URL rather than from the section's
          // data — the head is drawn in every state, including before that
          // data exists. `meta` is the data's, because "closed" against
          // "still ahead" is a fact about the day the server resolved.
          title={`${weekDayLabel(selectedDay)} in detail`}
          meta={(d) => d.meta}
          data={sections.day}
          pending={pending}
        >
          {(d) => (
            <>
              <MathLines rows={d.rows} />
              <p style={{ margin: "6px 0 0" }}>{d.moves}.</p>
            </>
          )}
        </Section>

        <Section
          title="How well we have been calling it"
          meta="the last reconciled window"
          data={sections.accuracy}
          pending={pending}
          askAbout="how accurate the forecast has been"
        >
          {(a) => (
            <>
              <MathLines rows={a.rows} />
              <div style={{ marginTop: "10px" }}>
                <Record marks={a.record} />
              </div>
              <Note>
                {a.note}
              </Note>
            </>
          )}
        </Section>
      </div>

      <div className="split">
        {/* N-R5. Zero rows is the production state, and it renders as the
            table's own four headers over nothing — the exact DOM the
            prototype draws around its rows, and no `.empty` landmark. */}
        <Section
          title="What you decided"
          meta={(rows) => `${rows.length} on file`}
          data={sections.ledger}
          pending={pending}
          pad={false}
        >
          {(rows) => <Table columns={LEDGER_COLUMNS} rows={ledgerRows(rows)} />}
        </Section>

        {/* N-R6. THREE items against the loader's five, and the head says so
            — the cap is on the page rather than hidden in the adapter. */}
        <Section
          title="What to do this week"
          meta={(q) => q.meta}
          data={sections.queue}
          pending={pending}
          askAbout="what to do this week"
        >
          {(q) => <Queue items={queueItems(q.items)} />}
        </Section>
      </div>
    </>
  )
}
