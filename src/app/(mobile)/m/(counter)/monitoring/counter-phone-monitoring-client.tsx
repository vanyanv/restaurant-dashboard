"use client"

import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { MonitoringSections } from "@/lib/counter/adapters/monitoring"

/** Monitoring, on a phone — `P.monitoring.phone()`. */
export function CounterPhoneMonitoringClient({
  sections,
}: {
  sections: SectionSources<MonitoringSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      {/* The page's own NAME is a constant, so it is drawn in every state.
          Inside the section it was not: a failed headline left this phone
          page with no title at all, showing "Monitoring unavailable" where
          its name belongs. Only the sub-line needs the data. Same rule the
          desk states on /dashboard/decisions — "the head is drawn in every
          state, including before that data exists". `Section bare` emits no
          DOM of its own, so the ready-state markup is unchanged. */}
      <div>
        <h2 className="mtitle">Monitoring</h2>
        <Section bare title="Monitoring" data={sections.headline} pending={pending}>
          {(h) => (
            <p className="msub">Developer-facing · {h.cells[0].delta}</p>
          )}
        </Section>
      </div>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section
        title="Subsystems"
        meta={(s) => s.meta}
        data={sections.subsystems}
        pending={pending}
      >
        {(s) => <MList rows={s.phoneRows} />}
      </Section>
    </>
  )
}
