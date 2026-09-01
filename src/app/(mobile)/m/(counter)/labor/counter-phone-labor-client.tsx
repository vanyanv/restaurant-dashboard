"use client"

import Link from "next/link"
import { useMemo } from "react"
import { Chart, MList, MStrip, Section, useCounterTransition, SubNav } from "@/components/counter"
import { storeViewTabs } from "@/lib/counter/nav"
import { readCounterParams } from "@/lib/counter/url-state"
import { rangeLabel } from "@/lib/counter/date-range"
import type { LaborSections } from "@/lib/counter/adapters/labor"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * Counter Labor — the group page, on a phone.
 *
 * `P.labor.phone()` at line 5592 of `docs/counter/counter-prototype.html`,
 * composed in its own order:
 *
 *   `.mtitle` / `.msub` → a two-cell `mstrip` → `sec('Scheduled vs actual',
 *   …, chart)` → `sec('By role', …, mlist)` → one `.mbtn.mbtn--primary`
 *
 * It calls the SAME adapter the desk calls (`getLaborSectionPromises`),
 * through the same `readCounterParams`, so no figure here can disagree with
 * the same figure on `/dashboard/labor`: they are the same fields off the
 * same `SectionData`, not a second reading of the range.
 *
 * ## THIS FILE DOES NO ARITHMETIC EITHER
 *
 * Same rule as the desk island's own note: every figure, caption and
 * sentence below is a field of the adapter's payload. The only strings this
 * file writes are chrome — the page title, the range in the subtitle, and the
 * chart's formatter, which cannot cross the RSC boundary as a function and so
 * has to be written on this side.
 *
 * ## What the phone drops, and it is the prototype that drops it
 *
 * | Desk | Phone |
 * |---|---|
 * | `.headline` + `.say` — the lead figure and the verdict | — |
 * | `.strip`, five cells | `.mstrip`, TWO cells: Hourly labor, SPLH |
 * | "The week, day by day" — the `WeekStrip` | — |
 * | "Scheduled against actual hours", chart + sentence | "Scheduled vs actual", chart only, ticks off, legend on |
 * | "The staffing curve" | — |
 * | "By role" table + "Where the hours leaked" table, side by side | "By role" as one `mlist`; the leak ledger is dropped |
 * | "Needs a decision" — a `Queue` + a sentence | one `.mbtn.mbtn--primary`, wired to the same decision |
 * | "Twelve weeks" | — |
 *
 * `phoneCells` is not a slice of the desk's five-cell `cells` — the adapter's
 * own docblock explains why: a page slicing by position would hand the phone
 * the wrong cell the moment a cell the desk carries (the leak cell, dropped
 * whenever the ledger fails to load) is absent.
 *
 * ## There is no floor and there is no band here either (L-R1)
 *
 * Same ruling as the desk. Nothing in this schema publishes an SPLH floor or a
 * labour target, so this file draws no verdict against one: no hit/miss
 * tint on the strip, no rule on the chart. What IS judged — where it is
 * judged at all — is the schedule the store published for itself, which is
 * what the schedule chart's two series already show without this file saying
 * a word about it.
 *
 * ## The caption-versus-delta trap
 *
 * `MCell` (the phone's per-cell renderer) opens its band only inside
 * `reference ? … : ''`, so a `caption` with no `reference` renders NOTHING at
 * all — silently, unlike the desk's `Figure`, which draws an EXTRA landmark
 * for the same prop. Neither cell below passes a `caption`; both qualifiers
 * ride in the `delta` slot instead, and both carry an explicit `deltaTone`
 * from the adapter (`buildHeadline`'s `phoneCells`) — an untoned `.strip .d`
 * paints `var(--good)`, which would turn "of Total Sales" and "platform sales
 * an hour" green as if they were good news rather than plain qualifiers.
 *
 * ## The primary button goes somewhere, or it goes nowhere at all
 *
 * `P.labor.phone()` ends with a hardcoded `<button>Cover Saturday
 * 2–6pm</button>`, wired to nothing real. `DecisionSection.items` is the
 * measured decision this page has instead (L-R8: the published schedule runs
 * out before the demand forecast does), and `/m/decisions`' own primary
 * button establishes the pattern for what replaces a hardcoded label: a
 * `<Link>` to the item's own `href`, rendered only when one exists. Today
 * `buildDecision` gives its one item no `href` and no `actLabel` — there is
 * no page this app serves that "publish the missing days" could point at —
 * so this block renders nothing rather than a button that goes nowhere. That
 * is this file's own decision, not the adapter's: the section is read here
 * exactly as `/m/decisions` reads its queue, and the day `buildDecision`
 * gains a destination for this item, this button starts rendering with no
 * change on this side.
 */
export function CounterPhoneLaborClient({
  params: paramsString,
  today,
  sections,
}: {
  /** The query string as PLAIN TEXT — a `URLSearchParams` loses its prototype crossing the RSC boundary. */
  params: string
  today: Date
  sections: SectionSources<LaborSections>
}) {
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  /*
   * This page owns no `push` of its own — the date sheet and the store
   * picker are `PhoneShell`'s (`MTop`/`MDateSheet`). `pending` is that same
   * transition, threaded to every `<Section>` below so a store or range
   * change reads as `stale` rather than a blank `loading.tsx`.
   */
  const { pending } = useCounterTransition()

  const { range } = counterParams
  // The window's own ENDS, never a preset's name — same convention as every
  // other Counter route's `windowLabel`. The store is not in this sub:
  // `.mtop`'s `.st` is already showing it, one element up.
  const windowLabel = rangeLabel(range, "custom")

  return (
    /*
     * A FRAGMENT. `.ct-root.ct-phone`, `.mtop` and `.mscroll` are
     * `src/app/(mobile)/m/(counter)/layout.tsx`'s. What is rendered here is
     * what goes INSIDE `.mscroll`, unchanged.
     */
    <>
      {/* `VIEWS`'s group/store pair, first inside `.mscroll`. "One store"
          appears only once a store is picked — the design's own sequence. */}
      <SubNav items={storeViewTabs("/m/labor", counterParams.storeId, paramsString)} label="Labor" />

      <div>
        <h2 className="mtitle">Labor</h2>
        <p className="msub">{windowLabel}</p>
      </div>

      {/* Two cells: Hourly labor, SPLH. `h.phoneCells`, never a slice of
          `h.cells` — see the file note above. */}
      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      {/* `s.phoneChart` is the adapter's own shorter, tickless, legend-on
          chart — not a reshaping done here. No sentence: at 340px there is no
          room left for the prose the desk prints beside its own chart, and
          the prototype's phone composition stops at the chart too. */}
      <Section
        title="Scheduled vs actual"
        meta={(s) => s.meta}
        data={sections.schedule}
        pending={pending}
      >
        {(s) => <Chart {...s.phoneChart} fmt={HOURS} />}
      </Section>

      {/* `r.phoneRows` — the adapter's own `MListRow[]`, built beside the
          desk's table so the two surfaces cannot format one role two ways.
          The leak ledger, the staffing curve and the twelve-week trend are
          not on this surface at all; see the file note's departure table. */}
      <Section title="By role" meta={(r) => r.meta} data={sections.roles} pending={pending}>
        {(r) => <MList rows={r.phoneRows} />}
      </Section>

      {/* Page level, below the last `.sec`, exactly where the prototype puts
          it — and pointed at somewhere real, or not rendered at all. See the
          file note. */}
      <Section bare title="Needs a decision" data={sections.decision} pending={pending}>
        {(d) =>
          d.items.length === 0 || !d.items[0].href ? null : (
            <Link className="mbtn mbtn--primary" href={d.items[0].href}>
              {d.items[0].actLabel ?? d.items[0].title}
            </Link>
          )
        }
      </Section>
    </>
  )
}

/** Hours on an axis. The prototype's `HRS`, at the one decimal a labour day is measured to. */
const HOURS = (v: number) => `${v.toFixed(1)} h`
