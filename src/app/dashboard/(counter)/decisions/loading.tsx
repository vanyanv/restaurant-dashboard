"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * The week ahead's content-only loading boundary.
 *
 * See `(counter)/loading.tsx` for why this is `"use client"` (`Section` calls
 * `useId()`) and why it is built from `Section` rather than a second skeleton:
 * passing `loading()` renders the same `Skeleton`, under the same title, in
 * the same box the resolved section will occupy, so there is exactly one
 * loading appearance in the product.
 *
 * Order and titles mirror `counter-decisions-client.tsx`'s own, including the
 * two `.split` pairs, so the shape a reader sees here is the shape that
 * replaces it. The one title that cannot match is the day panel's: the real
 * one is "<day> in detail" and this file has no searchParams to read the day
 * from, so it names the section by what it is.
 */
export default function DecisionsLoading() {
  return (
    <>
      <Section bare title="The call this week" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The verdict" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="The briefing" data={loading()}>
        {() => null}
      </Section>
      <Section title="The call this week" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="The day in detail" data={loading()}>
          {() => null}
        </Section>
        <Section title="How well we have been calling it" data={loading()}>
          {() => null}
        </Section>
      </div>
      <div className="split">
        <Section title="What you decided" data={loading()}>
          {() => null}
        </Section>
        <Section title="What to do this week" data={loading()}>
          {() => null}
        </Section>
      </div>
    </>
  )
}
