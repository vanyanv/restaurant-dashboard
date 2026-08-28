"use client"

import Link from "next/link"
import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import { dataOf } from "@/lib/counter/section-data"
import type { MenuItemSections } from "@/lib/counter/adapters/menu-item"

/**
 * One POS item, on a phone — `P.catalogitem.phone()`
 * (`docs/counter/counter-prototype.html:6967`): the title, a two-cell strip,
 * the channel list, and one primary button.
 *
 * The units chart and "Behind it" are desk-only, which is where the prototype
 * stops. The channel section's four-line note is desk-only too — a phone row
 * cannot carry the argument, and the figures it qualifies (Commission and Net
 * each) are not on this surface at all.
 */
export function CounterPhoneMenuItemClient({
  sections,
}: {
  sections: MenuItemSections
}) {
  const { pending } = useCounterTransition()
  const head = dataOf(sections.headline)

  return (
    <>
      <div>
        <h2 className="mtitle">{head?.title ?? "A menu item"}</h2>
        <p className="msub">{head?.sub ?? ""}</p>
      </div>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section
        title="By channel"
        meta={(c) => c.meta}
        data={sections.channels}
        pending={pending}
      >
        {(c) => <MList rows={c.phoneRows} />}
      </Section>

      <Link className="mbtn mbtn--primary" href="/dashboard/recipes">
        Open the recipe
      </Link>
    </>
  )
}
