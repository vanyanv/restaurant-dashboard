"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * One store's Labor, on the phone — content-only loading boundary.
 *
 * See `(counter)/loading.tsx` for why this is `"use client"` (`Section` calls
 * `useId()`) and why it is built from `Section` rather than a second
 * skeleton. Order and titles mirror
 * `counter-phone-store-labor-client.tsx`'s own: the bare strip, the schedule
 * chart, then the role list. There is no fourth entry — `StoreLaborSections`
 * carries `leaks`, `week` and `trend` too, but this surface only draws
 * `headline`, `schedule` and `roles` (see the brief's own composition), so a
 * loading skeleton for the others would promise a panel the loaded page never
 * draws.
 */
export default function MobileStoreLaborLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Scheduled vs actual" data={loading()}>
        {() => null}
      </Section>
      <Section title="By role" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
