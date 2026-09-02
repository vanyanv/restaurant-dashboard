"use client"

import { useMemo, useState, useTransition } from "react"
import {
  Chart,
  MList,
  MStrip,
  Section,
  useCounterTransition,
  type WeekDay,
  SubNav,
} from "@/components/counter"
import { PHONE_ALERT_TABS } from "@/lib/counter/nav"
import { readCounterParams } from "@/lib/counter/url-state"
import { weekLabel } from "@/lib/counter/week-window"
import type { DecisionsSections, PhoneQueue } from "@/lib/counter/adapters/decisions"
import { useRouter } from "next/navigation"
import { recordDecision } from "@/lib/counter/actions/decision"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * Counter Needs-you — the phone.
 *
 * `P.decisions.phone()` at line 4762 of `docs/counter/counter-prototype.html`,
 * composed in its order and stopping where it stops:
 *
 *   `.mtitle` / `.msub` → a two-cell `mstrip` → `sec('The call this week',
 *   'forecast', chart(bars)) ` → `sec('What to do', '3 open', mlist(3))` →
 *   one `.mbtn.mbtn--primary`
 *
 * It calls the SAME adapter the desk calls, with the SAME arguments, so no
 * figure here can disagree with the same figure on `/dashboard/decisions`:
 * they are the same week, out of the same load, read through the same
 * `SectionData`. The two strip cells are `head.phoneCells` and the three list
 * rows are `phoneQueue` — both built in the adapter beside the desk's own
 * (rulings N-R16 and `PnlHeadline.phoneCells`), so neither surface can round
 * or relabel a figure the other prints.
 *
 * ## The phone is a route, not a breakpoint
 *
 * `src/proxy.ts` rewrites `/dashboard/decisions` to `/m/decisions` on a
 * phone user agent. A screenshot of the desk at 390px photographs the desk
 * squeezed and says nothing about this file.
 *
 * ## What the phone drops, and it is the prototype that drops it
 *
 * | Desk | Phone |
 * |---|---|
 * | `.headline` — the lead figure and the verdict sentence | — |
 * | `.strip`, four cells | `.mstrip`, two cells |
 * | four `.briefline`s | — |
 * | the seven-cell `.wk` picker, clickable | seven bars, one chart |
 * | the day panel and the scorecard, side by side | — |
 * | the ledger table and the `.queue` | three `.mli` rows |
 *
 * The picker is the one worth naming. The desk's `.wk` carries forecast
 * against actual per day and presses into `?day=`; the phone draws the same
 * seven forecasts as bars and nothing else. That is the prototype's own
 * `chart({ type: 'bars', … })` with a single Forecast series — the actual is
 * not on this surface at all — and it is why `?day=` is still read by the
 * page: a link from a desk lands on the right day even though nothing here
 * changes it.
 *
 * ## The primary button COMMITS now, which is what its label always said
 *
 * `P.decisions.phone()` ends with `<button class="mbtn mbtn--primary">Commit
 * the first one</button>`. This note used to explain that the fixture wires it
 * to a global delegate we do not have, so it was a `<Link>` reading "Open the
 * first one" — "a button that does nothing is worse than no button".
 *
 * Correct then, and no longer the situation: `commitDecision` is wired, the
 * desk queue calls it, and `PhoneCommitFirst` calls it here. Nothing is lost
 * by giving up the link, because every row in the list above is already an
 * `.mli.is-link` to the same destination — the way to go look at the item is
 * one row up, on the item itself.
 *
 * It still renders only when the queue has an item, inside a `Section bare` on
 * the queue it reads, so a queue that failed to load leaves no control over
 * nothing.
 */

/**
 * COMMITTING THE WEEK'S FIRST CALL, FROM THE PHONE.
 *
 * `P.decisions.phone()` ends on one `<button class="mbtn mbtn--primary">Commit
 * the first one</button>`. This page drew it as a LINK reading "Open the first
 * one", and the file note above said why: the fixture wires it to a global
 * delegate we do not have, and "a button that does nothing is worse than no
 * button".
 *
 * That was right, and it is no longer the situation. `commitDecision` is wired
 * — the desk queue's "I did this" calls it — so the control can carry the
 * fixture's own label and do the fixture's own job.
 *
 * Nothing is lost by giving up the link: every row in the list above is
 * already an `.mli.is-link` to the same destination, so the way to go look at
 * the item is still there, one row up, where the item itself is.
 *
 * One button, matching the fixture exactly. Committing freezes the forecast
 * alongside the row (see `recordDecision`), which is the whole point of
 * recording it from wherever the owner happens to be standing rather than
 * waiting until they are back at a desk.
 */
function PhoneCommitFirst({ first }: { first: NonNullable<PhoneQueue["first"]> }) {
  const router = useRouter()
  const [saving, startSaving] = useTransition()
  const [said, setSaid] = useState<string | null>(null)

  const commit = () => {
    setSaid(null)
    startSaving(async () => {
      const result = await recordDecision(
        {
          storeId: first.ref.storeId,
          opportunityType: first.ref.type,
          opportunityTitle: first.ref.title,
          opportunityAsOf: first.ref.asOf,
          predictedImpactUsdPerWeek: first.ref.impactUsdPerWeek,
          predictedImpactP10: first.ref.p10,
          predictedImpactP90: first.ref.p90,
        },
        "commit",
      )
      if (!result.ok) {
        setSaid("That did not save.")
        return
      }
      router.refresh()
    })
  }

  return (
    <>
      <button
        className="mbtn mbtn--primary"
        type="button"
        disabled={saving}
        onClick={commit}
      >
        {saving ? "Saving…" : "Commit the first one"}
      </button>
      {said ? <p className="msub">{said}</p> : null}
    </>
  )
}

export function CounterPhoneDecisionsClient({
  params: paramsString,
  today,
  sections,
}: {
  /** The query string as PLAIN TEXT — a `URLSearchParams` loses its prototype crossing the RSC boundary. */
  params: string
  today: Date
  sections: SectionSources<DecisionsSections>
}) {
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  // Read for the same reason `/m/orders` reads its filters: the params this
  // page was rendered for are the params the adapter was asked with, and
  // reading them here is what proves the two agree.
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])
  void counterParams

  /*
   * This page owns no `push` of its own — the date sheet and the store picker
   * are `PhoneShell`'s, and there is no day picker on this surface.
   * `pending` is that same transition, threaded to every `<Section>` below so
   * a store change reads as `stale` rather than a blank `loading.tsx`.
   */
  const { pending } = useCounterTransition()

  // The week the chart draws, named by its ends. `today` came from the
  // server, which is also where the adapter's `asOf` came from, so the sub
  // and the seven bars cannot name two different weeks — and the desk's own
  // sub is this same string from this same function.
  const window = weekLabel(today)

  return (
    /*
     * A FRAGMENT. `.ct-root.ct-phone`, `.mtop` and `.mscroll` are
     * `src/app/(mobile)/m/(counter)/layout.tsx`'s. What is rendered here is
     * what goes INSIDE `.mscroll`.
     */
    <>
      {/* The design's `VIEWS` bar, first inside `.mscroll` — which is exactly
          where `phoneFor()` puts a `.seg`. Same destinations as the desk's,
          on `/m` paths. */}
      <SubNav items={PHONE_ALERT_TABS} label="Alerts" />

      {/* The store is not in this sub: `.mtop`'s `.st` is already showing it,
          one element up. */}
      <div>
        <h2 className="mtitle">The week ahead</h2>
        <p className="msub">{window}</p>
      </div>

      {/* TWO cells, built in the adapter rather than sliced off the desk's
          four: a slice picks by POSITION out of a list whose length depends
          on the data. Both are the same figures the desk prints. */}
      <Section bare title="The figures" data={sections.head} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="The call this week" meta="forecast" data={sections.week} pending={pending}>
        {(days) => (
          <Chart
            type="bars"
            h={116}
            zero
            labels={days.map(initial)}
            // `var(--ink)` is the prototype's own, and a token reference is
            // the only colour a Counter file may name.
            series={[{ name: "Forecast", color: "var(--ink)", data: days.map((d) => d.forecast) }]}
            alt="Forecast revenue for each day of the week"
          />
        )}
      </Section>

      {/* `mlist` of three — the adapter's `phoneQueue`, which is the desk's
          own three items in `.mli` shape. The meta is that section's own
          "3 of 5" claim, said the same way the desk says it. */}
      <Section title="What to do" meta={(q) => q.meta} data={sections.phoneQueue} pending={pending}>
        {(q) => <MList rows={q.items} />}
      </Section>

      {/* Page level, below the last `.sec`, exactly where the prototype puts
          it — and pointed at somewhere real. See the file note. */}
      <Section bare title="Commit the first one" data={sections.phoneQueue} pending={pending}>
        {(q) => (q.first === null ? null : <PhoneCommitFirst first={q.first} />)}
      </Section>
    </>
  )
}

/**
 * `['M','T','W','T','F','S','S']` — the prototype's own axis labels.
 *
 * Taken off the cell's label ("Mon 24") rather than recomputed from its date:
 * the label is the adapter's, and the axis has to name the same day the bar
 * carries. Seven single letters with two Ts and two Ss is ambiguous read
 * alone, which is why the prototype pairs the chart with a tooltip that
 * carries the full reading — `Chart` does the same.
 */
function initial(d: WeekDay): string {
  return d.label.charAt(0)
}
