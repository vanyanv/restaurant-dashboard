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
      {/* The page's own NAME is a constant, so it is drawn in every state.
          Inside the section it was not: a failed headline left this phone
          page with no title at all, showing "Stores unavailable" where
          its name belongs. Only the sub-line needs the data. Same rule the
          desk states on /dashboard/decisions — "the head is drawn in every
          state, including before that data exists". `Section bare` emits no
          DOM of its own, so the ready-state markup is unchanged. */}
      <div>
        <h2 className="mtitle">Stores</h2>
        <Section bare title="Stores" data={sections.headline} pending={pending}>
          {(h) => (
            <p className="msub">
              {h.cells[0].value} locations · {h.cells[0].delta}
            </p>
          )}
        </Section>
      </div>

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
