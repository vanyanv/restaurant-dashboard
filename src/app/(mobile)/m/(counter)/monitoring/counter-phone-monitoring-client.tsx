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
      <Section bare title="Monitoring" data={sections.headline} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">Monitoring</h2>
            <p className="msub">Developer-facing · {h.cells[0].delta}</p>
          </div>
        )}
      </Section>

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
