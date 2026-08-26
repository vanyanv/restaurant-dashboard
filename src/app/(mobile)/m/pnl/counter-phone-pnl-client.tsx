"use client"

import { useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  Cascade,
  MDateSheet,
  MList,
  MStrip,
  MTop,
  MoneyLines,
  Section,
  type MListRow,
  type MoneyLine,
  type SwitchableStore,
  type WeekRow,
} from "@/components/counter"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import {
  dayCount,
  monthDay,
  rangeLabel,
  type ComparisonId,
  type DateRange,
  type PresetId,
} from "@/lib/counter/date-range"
import { money, pct } from "@/lib/counter/format"
import { PRIME_CEILING_PCT } from "@/lib/counter/prime-cost"
import type { PnlSections, PnlStatement } from "@/lib/counter/adapters/pnl"

/**
 * Counter P&L — the phone.
 *
 * `P.pnl.phone()` at line 5354 of `docs/counter/counter-prototype.html`,
 * composed in its order:
 *
 *   `.mtitle` / `.msub` → a two-cell `mstrip` → the `.wf` cascade →
 *   six weeks as an `.mlist` → the statement as seven `.moneyline`s →
 *   the note about what the fixed lines were charged for this range.
 *
 * It calls the SAME adapter the desk calls (`getPnlSections`), through the
 * same `readCounterParams`, so no figure here can disagree with the same
 * figure on `/dashboard/pnl`: they are the same number, out of the same
 * rollup, read through the same `SectionData`.
 *
 * ## The phone is a route, not a breakpoint
 *
 * `src/middleware.ts` rewrites `/dashboard/pnl` to `/m/pnl` on a phone user
 * agent, so THIS is what a phone renders and what `npm run fidelity`'s
 * `fidelity-mobile` project measures against `P.pnl.phone()`. Taking a
 * screenshot of `/dashboard/pnl` at 390px photographs the desk squeezed and
 * says nothing about this file.
 *
 * ## What the phone drops, and it is the prototype that drops it
 *
 * | Desk | Phone |
 * |---|---|
 * | `.strip`, five cells, three `.sp` sparklines | `.mstrip`, two cells, no sparkline |
 * | the reading paragraph (`.ans__lead`) | — |
 * | the eight-week `.wkt` table with bars and meters | six rows of `.mlist` |
 * | the nine-line `.tbl` statement with a change column | seven `.moneyline`s |
 * | the food-cause split and the trust panel | — |
 * | the by-store table | — |
 *
 * The two `.sec`s the phone drops are the two this schema cannot fill anyway
 * (`foodCause` and `trust` are both `not_computed`), so nothing owed is
 * hidden by leaving them off: the desk still names both.
 *
 * ## What this page replaced
 *
 * The editorial mobile P&L: `PageHead` + `MPnLToolbar` + `MastheadFigures` +
 * a by-store `Panel` of links, driven by `getMobilePnLOverview` and a
 * `?period=this-week` vocabulary of its own. Three figures where the design
 * shows eleven, and — the reason it could not be kept alongside — it read a
 * different range parameter than the desk, so a phone and a desk open on the
 * same account showed different windows and neither said so. Its loader and
 * its toolbar are left in place; `/m/pnl/[storeId]` still uses both.
 *
 * ## The empty state is `Section`'s, four times, not the prototype's one block
 *
 * `P.pnl.phone()` opens with `if (eff() === 'empty') return …` and replaces
 * the page with one message. A Counter page may not do that — it would be
 * branching on section state, which `npm run tokens` fails the build on, and
 * `Section` is the sole state renderer. So a pre-open account gets each
 * section carrying `Empty`'s own reason and back-out. Same ruling as the
 * desk's (task 4, C7).
 */
export function CounterPhonePnlClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  /** The query string as PLAIN TEXT — a `URLSearchParams` loses its prototype crossing the RSC boundary. */
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: PnlSections
}) {
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])
  const router = useRouter()

  /** Every control on this page goes through here, exactly as the desk's do. */
  const push = useCallback(
    (next: Parameters<typeof writeCounterParams>[1]) => {
      const qs = writeCounterParams(params, next).toString()
      router.push(qs ? `/m/pnl?${qs}` : "/m/pnl", { scroll: false })
    },
    [params, router],
  )

  /**
   * Where a week row goes. `writeCounterParams({ range })` writes `?from=…&to=…`
   * — the SAME parameters the date sheet above writes, so pressing a week and
   * picking that window off the calendar land on one URL.
   *
   * An `<a>`, not the prototype's `data-setrange` on a div: `MList` renders a
   * row with an `href` as a link, which gets middle-click, "open in new tab",
   * the right role and keyboard activation for free. The prototype has no
   * router and could not.
   */
  const weekHref = useCallback(
    (range: DateRange) => {
      const qs = writeCounterParams(params, { range }).toString()
      return qs ? `/m/pnl?${qs}` : "/m/pnl"
    },
    [params],
  )

  const { range, presetId, comparisonId } = counterParams
  const windowLabel = rangeLabel(range, presetId)
  const days = dayCount(range)

  return (
    // `.ct-root` and `.ct-phone` sit ONE ELEMENT ABOVE `.mscroll`, so `.mtop`
    // is inside them too — `.pframe`'s own arrangement. `.mtop` reads
    // `--chrome` and `--line`, which the alias layer declares only on a
    // Counter root, and `.ct-phone` is the phone's type scale. See
    // `counter-phone-overview-client.tsx` for the long version.
    <div className="ct-root ct-phone">
      <MTop
        stores={stores}
        selectedStoreId={counterParams.storeId}
        onSelectStore={(id) => push({ storeId: id })}
        date={
          <MDateSheet
            presetId={presetId}
            comparisonId={comparisonId}
            range={range}
            onPreset={(id: PresetId) => push({ presetId: id })}
            onComparison={(id: ComparisonId) => push({ comparisonId: id })}
            onRange={(next: DateRange) => push({ range: next })}
          />
        }
      />

      <div className="mscroll">
        {/*
          The page's NAME, not a sentence about the range — a statement is the
          same document whatever window it is drawn over, and the window is the
          line beneath. The store is not in this sub: `.mtop`'s `.st` is
          already showing it, one element up.
        */}
        <div>
          <h2 className="mtitle">Profit and loss</h2>
          <p className="msub">
            {windowLabel} · {days} {days === 1 ? "day" : "days"}
          </p>
        </div>

        {/* Two cells. The reading paragraph beside them on the desk is not on
            this surface, so the strip is the whole headline here. */}
        <Section bare title="The figures" data={sections.headline}>
          {(h) => <MStrip cells={h.phoneCells} />}
        </Section>

        <Section title="Where it went" meta={windowLabel} data={sections.cascade}>
          {(c) => <Cascade start={c.start} cuts={c.cuts} end={c.end} />}
        </Section>

        {/* SIX weeks, not the desk's eight, and the most recent six — the
            prototype's own `weekRows(6)`, oldest first. */}
        <Section title="Week by week" meta="tap a week" data={sections.weeks}>
          {(w) => <MList rows={w.rows.slice(-6).map((row) => toWeekRow(row, weekHref))} />}
        </Section>

        <Section title="The statement" meta={windowLabel} data={sections.statement}>
          {(s) => (
            <>
              <MoneyLines rows={statementRows(s)} />
              {/*
                Inside the section rather than the prototype's sibling
                position, because it prints a figure OFF this section's data:
                a note naming a number that failed to load is worse than no
                note. The desk's statement footnote sits in the same place for
                the same reason.
              */}
              <p className="mono" style={{ margin: "8px 0 0" }}>
                Rent and the other monthly lines are charged at {s.fixedInRange} for these {days}{" "}
                {days === 1 ? "day" : "days"}, not a whole month.
              </p>
            </>
          )}
        </Section>
      </div>
    </div>
  )
}

/**
 * One week as one `.mli`.
 *
 * `[wkLabel + partial, gross · prime, bottom, margin, up|down]` — the
 * prototype's own five slots. The row PROMISES that its figures are the
 * figures the page will show when it is pressed, which holds because the
 * week's load and the pressed range use the same bounds and the same cache
 * entry (see the adapter's note on the eight windows).
 */
function toWeekRow(row: WeekRow, href: (range: DateRange) => string): MListRow {
  const { window: w } = row
  return {
    key: w.start.toISOString(),
    title: `${monthDay(w.start)}${w.partial ? ` · ${w.days}d` : ""}`,
    detail: `${money(row.grossSales)} · prime ${pct(row.primePct, { scaled: true })}`,
    value: money(row.bottomLine),
    note: pct(row.marginPct, { scaled: true }),
    // The prototype's own rule: a week is `down` when its PRIME cost beat the
    // ceiling, not when its margin was small. `PRIME_CEILING_PCT` is the
    // trade's published benchmark that `prime-cost.ts` owns — the same
    // constant the desk's `WeekTable` reads, so one week cannot be over the
    // ceiling on one surface and under it on the other.
    noteTone: row.primePct !== null && row.primePct > PRIME_CEILING_PCT ? "down" : "up",
    href: href({ start: w.start, end: w.end }),
  }
}

/**
 * The seven lines the phone's statement prints, and what it calls each of them.
 *
 * The desk prints NINE: it keeps "Net revenue" and "Prime cost", the two
 * subtotals that only mean something beside a change column. The phone drops
 * both — the prototype's own `money([…])` — because a subtotal with no
 * comparison against it is a row a reader scrolls past.
 *
 * The words are the prototype's, including "Commissions" where the desk and
 * the cascade both say "Marketplace commissions". That is not a second name
 * for a second figure: it is the same line, shortened for a 316px column, and
 * the amount comes from the adapter either way.
 */
const PHONE_LINES: ReadonlyArray<readonly [key: string, label: string]> = [
  ["gross", "Gross sales"],
  ["commissions", "Commissions"],
  ["food", "Food"],
  ["labor", "Labor"],
  ["occupancy", "Occupancy"],
  ["other", "Other operating"],
  ["bottom", "Bottom line"],
]

function statementRows(s: PnlStatement): MoneyLine[] {
  const byKey = new Map(s.lines.map((l) => [l.key, l]))
  const out: MoneyLine[] = []
  for (const [key, label] of PHONE_LINES) {
    const line = byKey.get(key)
    // A line the adapter did not produce is left out rather than printed
    // empty: the statement's shape is the adapter's answer, not this list's.
    if (!line) continue
    out.push({
      label,
      value: line.amount,
      // The prototype paints two rows: commissions always, and food when it
      // beat the target on file. `over` is the adapter's judgement — this
      // page never compares a percentage to a target.
      tone: key === "commissions" || line.over ? "bad" : undefined,
      total: key === "bottom",
    })
  }
  return out
}
