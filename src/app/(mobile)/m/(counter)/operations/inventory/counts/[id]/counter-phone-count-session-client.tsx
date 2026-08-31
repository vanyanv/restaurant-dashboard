"use client"

import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { CountSessionSections } from "@/lib/counter/adapters/stock-counts"

/**
 * One count session, on a phone — `P.countsession.phone()`.
 *
 * A masthead, a two-cell strip and the lines. The prototype calls its list
 * "Biggest gaps" and sorts by variance; there is no variance in this account
 * to sort by, so it is the lines in the order they were counted, which is the
 * order someone walking the shelves entered them.
 *
 * The variance panel and the worklist are desk-only. Both are arguments about
 * what the count cannot tell you yet, and this surface is the one you hold
 * while counting.
 */
export function CounterPhoneCountSessionClient({
  title,
  sections,
}: {
  title: string
  sections: SectionSources<CountSessionSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title={title} data={sections.head} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">{h.title}</h2>
            <p className="msub">{h.sub}</p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.head} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="What was counted" meta={(l) => l.meta} data={sections.lines} pending={pending}>
        {(l) => (
          <>
            <MList rows={l.phoneRows} />
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {l.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
