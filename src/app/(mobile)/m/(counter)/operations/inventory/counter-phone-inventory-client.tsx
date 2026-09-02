"use client"

import Link from "next/link"
import { MHead, MStrip, MoneyLines, Section, useCounterTransition, SubNav } from "@/components/counter"
import { PHONE_INVENTORY_TABS } from "@/lib/counter/nav"
import type { InventorySections } from "@/lib/counter/adapters/inventory"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * Inventory, on a phone — `P.inventory.phone()`
 * (`docs/counter/counter-prototype.html:5762`).
 *
 * ## The prototype's phone surface is a keypad, and the keypad already exists
 *
 * `P.inventory`'s own note says it: *"On the desk it is a table; on the phone
 * it is a keypad, one item at a time."* That keypad is built and works — a
 * session, a pad and a save, at `/m/count`. It is not Counter-styled, and
 * restyling it is `P.countnew`'s job: its own page in the prototype and its own
 * row in the manifest.
 *
 * Building a SECOND keypad here would give this account two ways to start a
 * count and still no completed one. So this surface keeps the prototype's
 * landmark shape — head, strip, one section — reports the state of the count,
 * and sends the reader to the pad that works.
 */
export function CounterPhoneInventoryClient({
  sections,
}: {
  sections: SectionSources<InventorySections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      {/* The design's `VIEWS` bar, first inside `.mscroll` — which is exactly
          where `phoneFor()` puts a `.seg`. Same destinations as the desk's,
          on `/m` paths. */}
      <SubNav items={PHONE_INVENTORY_TABS} label="Inventory" />

      {/* THE TITLE IS STILL GATED HERE, deliberately, unlike the 21 other
          phone pages this was hoisted out of. Its sub-line is `{n.meta}` —
          genuinely data — so the `<div>` cannot leave the section wholesale,
          and every way to lift just the `<h2>` costs more than it buys: put
          the h2 in its own div and `.mscroll` (a grid) gains an item and an
          11px gap on this page alone; split the msub and the `MHead` into two
          Sections over one promise and a failure paints two cards instead of
          one. Left as it is until the head earns a shape of its own. */}
      <Section bare title="Inventory" data={sections.nextCount} pending={pending}>
        {(n) => (
          <>
            <div>
              <h2 className="mtitle">Inventory</h2>
              <p className="msub">{n.meta}</p>
            </div>
            {/* `.mhead` is the prototype's own second block here — its version
                names the item being counted right now. There is no count in
                progress, so this one names how far the last one got. */}
            <MHead
              label={n.head.label}
              value={n.head.value}
              delta={n.head.delta}
              deltaTone="is-down"
              note={<p className="mono">{n.head.note}</p>}
            />
          </>
        )}
      </Section>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section
        title="What a count would settle"
        meta={(s) => s.meta}
        data={sections.settle}
        pending={pending}
      >
        {(s) => <MoneyLines rows={s.money} />}
      </Section>

      <Section bare title="Next count" data={sections.nextCount} pending={pending}>
        {() => (
          <Link className="mbtn mbtn--primary" href="/m/count">
            Start the count
          </Link>
        )}
      </Section>
    </>
  )
}
