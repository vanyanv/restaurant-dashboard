"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The item page's loading boundary — the four entries the client renders. */
export default function MenuItemLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Units sold" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="By channel" data={loading()} pad={false}>
          {() => null}
        </Section>
        <Section title="Behind it" data={loading()}>
          {() => null}
        </Section>
      </div>
    </>
  )
}
