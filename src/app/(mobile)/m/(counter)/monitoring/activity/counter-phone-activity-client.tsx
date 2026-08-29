"use client"

import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { ActivitySections } from "@/lib/counter/adapters/monitoring-people"

/**
 * Activity, on a phone — `P.monactivity.phone()`.
 *
 * The verdict sentence carries the whole page, so it is the phone's masthead
 * rather than an extra panel. The errors-by-hour chart is desk-only: 24 bars
 * of which three are non-zero is a picture that says less than the list under
 * it.
 */
export function CounterPhoneActivityClient({
  sections,
}: {
  sections: SectionSources<ActivitySections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="Activity" data={sections.headline} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">Activity</h2>
            <p className="msub">{h.verdict}</p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section
        title="Recent errors"
        meta={(e) => e.meta}
        data={sections.errors}
        pending={pending}
      >
        {(e) => <MList rows={e.phoneRows} />}
      </Section>
    </>
  )
}
