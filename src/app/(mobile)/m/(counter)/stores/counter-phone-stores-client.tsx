"use client"

import Link from "next/link"

import { MList, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { StoresSections } from "@/lib/counter/adapters/stores"

/**
 * Stores, on a phone — `P.stores.phone()`: the title, the locations, and one
 * button into a store file.
 *
 * NO strip. This page had one and the design does not: `P.stores.phone()` is a
 * masthead, a list and an `.mbtn`, because the phone's question here is "which
 * store, and what is missing on it" — which the list answers on every row. A
 * two-cell strip above it repeated the count of locations that the masthead
 * already gives.
 */
export function CounterPhoneStoresClient({
  sections,
}: {
  sections: SectionSources<StoresSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="Stores" data={sections.headline} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">Stores</h2>
            <p className="msub">
              {h.cells[0].value} locations · {h.cells[0].delta}
            </p>
          </div>
        )}
      </Section>

      <Section title="Locations" meta={(t) => t.meta} data={sections.table} pending={pending}>
        {(t) => <MList rows={t.phoneRows} />}
      </Section>

      {/* `P.stores.phone()`'s closing `.mbtn`, outside every section and
          carrying no landmark class — the design's own shape. */}
      <Section bare title="Open a store file" data={sections.table} pending={pending}>
        {(t) =>
          t.primary ? (
            <Link className="mbtn mbtn--primary" href={t.primary.href}>
              {t.primary.label}
            </Link>
          ) : null
        }
      </Section>
    </>
  )
}
