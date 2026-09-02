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
      {/* The page's own NAME is a constant, so it is drawn in every state.
          Inside the section it was not: a failed headline left this phone
          page with no title at all, showing "Activity unavailable" where
          its name belongs. Only the sub-line needs the data. Same rule the
          desk states on /dashboard/decisions — "the head is drawn in every
          state, including before that data exists". `Section bare` emits no
          DOM of its own, so the ready-state markup is unchanged. */}
      <div>
        <h2 className="mtitle">Activity</h2>
        <Section bare title="Activity" data={sections.headline} pending={pending}>
          {(h) => (
            <p className="msub">{h.verdict}</p>
          )}
        </Section>
      </div>

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
