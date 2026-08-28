"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The catalog's loading boundary — the four entries the client renders. */
export default function CatalogLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <div className="sec">
        <Section bare title="The catalog" data={loading()}>
          {() => null}
        </Section>
      </div>
      <div className="split">
        <Section title="Unmapped items" data={loading()}>
          {() => null}
        </Section>
        <Section title="By category" data={loading()}>
          {() => null}
        </Section>
      </div>
    </>
  )
}
