"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * One store's Labor, content-only loading boundary.
 *
 * See `(counter)/loading.tsx` for why this is `"use client"` (`Section` calls
 * `useId()`) and why it is built from `Section` rather than a second skeleton:
 * passing `loading()` renders the same `Skeleton`, under the same title, in the
 * same box the resolved section will occupy, so there is exactly one loading
 * appearance in the product.
 *
 * Order and titles mirror `counter-store-labor-client.tsx`'s own — the bare
 * note-and-strip block, the schedule chart, the `.split` pair, the week table,
 * then the trend — so the shape a reader sees here is the shape that replaces
 * it.
 */
export default function StoreLaborLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Scheduled against actual" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="By role" data={loading()}>
          {() => null}
        </Section>
        <Section title="Where the hours leaked" data={loading()}>
          {() => null}
        </Section>
      </div>
      <Section title="The week, day by day" data={loading()}>
        {() => null}
      </Section>
      <Section title="Twelve weeks" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
