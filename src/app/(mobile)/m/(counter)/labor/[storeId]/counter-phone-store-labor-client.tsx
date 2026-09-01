"use client"

import { useMemo } from "react"
import {
  Chart,
  MList,
  MStrip,
  Section,
  useCounterTransition,
  usePageChrome,
  type SwitchableStore,
  SubNav,
} from "@/components/counter"
import { storeViewTabs } from "@/lib/counter/nav"
import { readCounterParams } from "@/lib/counter/url-state"
import { rangeLabel } from "@/lib/counter/date-range"
import type { StoreLaborSections } from "@/lib/counter/adapters/labor"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * One store's Labor — the phone. The store arm of the same shape
 * `counter-phone-labor-client.tsx` draws for the group page:
 *
 *   `.mtitle` (the store's own name) / `.msub` (the range) →
 *   a two-cell `mstrip` (Labor % · Leak) →
 *   `sec('Scheduled vs actual', …, chart)` →
 *   `sec('By role', …, mlist)`
 *
 * It calls the SAME adapter the desk sibling calls
 * (`getStoreLaborSectionPromises`), through the same `readCounterParams`, so
 * no figure here can disagree with the same figure on
 * `/dashboard/labor/<storeId>`: they are the same fields off the same
 * `SectionData`, not a second reading of the range.
 *
 * ## THIS FILE DOES NO ARITHMETIC EITHER
 *
 * Same rule as every other Counter island's own note: every figure, caption
 * and row below is a field of the adapter's payload, already formatted. The
 * only strings this file writes are chrome — the page title (the store's own
 * name, not "Labor" — same choice `counter-phone-store-analytics-client.tsx`
 * makes), the range in the subtitle, and the chart's formatter, which cannot
 * cross the RSC boundary as a function.
 *
 * ## What this surface drops, and why
 *
 * `StoreLaborSections` has six members: `headline`, `schedule`, `roles`,
 * `leaks`, `week` and `trend`. This file draws three. The leak ledger, the
 * week table and the twelve-week trend are the desk sibling's own `.split`,
 * table and closing chart — the same departure the group phone page already
 * makes from ITS desk sibling (dropping the week strip, the staffing curve
 * and the twelve-week trend), for the same standing reason: mobile is a
 * lean glance-and-do tool, not the desk squeezed onto 390px. The leak total
 * IS on this screen, though — folded into the strip's second cell, exactly
 * as `buildHeadline`'s store arm intends it (`phoneCells` is Labour % and
 * Leak, never a slice of the desk's four-cell `cells`).
 *
 * ## The caption-versus-delta trap, and there is no SPLH floor either
 *
 * Same two rulings as the group phone page's own note (L-R1, and the
 * `MCell`/`reference` trap): nothing here passes a `caption` to `MStrip`, and
 * both cells' qualifiers ride in the delta slot with an explicit tone from
 * `buildHeadline`'s store arm, never an untoned `.strip .d` that would paint
 * a plain qualifier `var(--good)`. And no verdict is drawn against an SPLH
 * floor or a labour target — nothing in this schema publishes one.
 */
export function CounterPhoneStoreLaborClient({
  params: paramsString,
  storeId,
  stores,
  today,
  sections,
}: {
  /** The query string this page was rendered for, as PLAIN TEXT — not a `URLSearchParams` instance. */
  params: string
  /** The PATH's store — what scopes this page. There is no `?store=` here. */
  storeId: string
  stores: SwitchableStore[]
  today: Date
  sections: SectionSources<StoreLaborSections>
}) {
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  const store = stores.find((s) => s.id === storeId) ?? null
  // `page.tsx` 404s on a store the switcher does not list, so this fallback is
  // for a store list that failed to load rather than for a wrong id.
  const storeName = store?.name ?? "This store"

  // The store is published upward because the URL cannot say it here: the
  // phone's `.mtop` reads `?store=`, and there is none on this route, so
  // without this the sheet would show "All stores" on a page about one, and
  // its picker would highlight nothing.
  usePageChrome({ storeId, storeName })

  // The ONE transition shared with `PhoneShell`'s own store sheet and date
  // sheet, so a store or range change reads as `stale` rather than a blank
  // `loading.tsx`.
  const { pending } = useCounterTransition()

  const { range } = counterParams
  // The window's own ENDS, never a preset's name — same convention as every
  // other Counter route's `windowLabel`.
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
      <SubNav items={storeViewTabs("/m/labor", storeId, paramsString)} label="Labor" />

      {/* The store's own name, not "Labor" — the prototype's own store-page
          convention, matched by `counter-phone-store-analytics-client.tsx`.
          The window is the line beneath, alone. */}
      <div>
        <h2 className="mtitle">{storeName}</h2>
        <p className="msub">{windowLabel}</p>
      </div>

      {/* Two cells: Labor % · Leak — `h.phoneCells`, the store arm of
          `buildHeadline`, never a slice of `h.cells` (which carries four:
          Hourly labor, Hours, Sales / labor hour, Leak, and loses the Leak
          cell whenever the ledger fails to load). */}
      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      {/* `s.phoneChart` is the adapter's own shorter, tickless, legend-on
          chart — not a reshaping done here. No sentence: at 340px there is no
          room left for the prose the desk prints beside its own chart. */}
      <Section
        title="Scheduled vs actual"
        meta={(s) => s.meta}
        data={sections.schedule}
        pending={pending}
      >
        {(s) => <Chart {...s.phoneChart} fmt={HOURS} />}
      </Section>

      {/* `r.phoneRows` — the adapter's own `MListRow[]`, built beside the
          desk's table so the two surfaces cannot format one role two ways. */}
      <Section title="By role" meta={(r) => r.meta} data={sections.roles} pending={pending}>
        {(r) => <MList rows={r.phoneRows} />}
      </Section>
    </>
  )
}

/** Hours on an axis. The prototype's `HRS`, at the one decimal a labour day is measured to. */
const HOURS = (v: number) => `${v.toFixed(1)} h`
