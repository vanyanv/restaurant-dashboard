"use client"

import Link from "next/link"

import { MList, MStrip, Note, Section, SubNav, useCounterTransition } from "@/components/counter"
import { PHONE_INVENTORY_TABS } from "@/lib/counter/nav"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { StockCountsSections } from "@/lib/counter/adapters/stock-counts"

/**
 * Stock counts, on a phone — `P.counts.phone()`.
 *
 * The prototype ends in a primary "Resume the count" button. There is nothing
 * to resume that a phone should resume: the two open sessions have been open
 * since May, and a button that reopens a four-month-old count as if it were
 * this evening's work is the wrong offer. The list carries the sessions; the
 * variance section is desk-only, because it is an explanation rather than a
 * figure.
 */
export function CounterPhoneCountsClient({
  sections,
}: {
  sections: SectionSources<StockCountsSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      {/* The design's `VIEWS` bar, first inside `.mscroll` — which is exactly
          where `phoneFor()` puts a `.seg`. Same destinations as the desk's,
          on `/m` paths. */}
      <SubNav items={PHONE_INVENTORY_TABS} label="Inventory" />

      {/* The page's own NAME is a constant, so it is drawn in every state.
          Inside the section it was not: a failed headline left this phone
          page with no title at all, showing "Stock counts unavailable" where
          its name belongs. Only the sub-line needs the data. Same rule the
          desk states on /dashboard/decisions — "the head is drawn in every
          state, including before that data exists". `Section bare` emits no
          DOM of its own, so the ready-state markup is unchanged. */}
      <div>
        <h2 className="mtitle">Stock counts</h2>
        <Section bare title="Stock counts" data={sections.headline} pending={pending}>
          {(h) => (
            <p className="msub">
              Last count {h.cells[0].value} · {h.cells[0].delta}
            </p>
          )}
        </Section>
      </div>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="Sessions" meta={(s) => s.meta} data={sections.sessions} pending={pending}>
        {(s) => (
          <>
            <MList rows={s.phoneRows} />
            <Note>
              {s.note}
            </Note>
          </>
        )}
      </Section>

      {/* `P.counts.phone()`'s closing `.mbtn`. It resumes the open count
          rather than starting one — `progressOf` already decides which, and
          the desk button reads the same field. With nothing open it links to
          the wizard instead, because a phone that cannot start a count is a
          phone that cannot count. */}
      <Section bare title="Resume" data={sections.progress} pending={pending}>
        {(p) => (
          <Link
            className="mbtn mbtn--primary"
            href={p.href ?? "/m/operations/inventory/count/new"}
          >
            {p.href ? "Resume the count" : "Start a count"}
          </Link>
        )}
      </Section>
    </>
  )
}
