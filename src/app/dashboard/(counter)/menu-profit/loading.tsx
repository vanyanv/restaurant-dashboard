"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Order and titles mirror `counter-menu-profit-client.tsx`. */
export default function MenuProfitLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="Volume against margin" data={loading()}>
          {() => null}
        </Section>
        <Section title="What to do about it" data={loading()}>
          {() => null}
        </Section>
      </div>
      <Section title="What these figures did not see" data={loading()}>
        {() => null}
      </Section>
      <Section title="Item ledger" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
