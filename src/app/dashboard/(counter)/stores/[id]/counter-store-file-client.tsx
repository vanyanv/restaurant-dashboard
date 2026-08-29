"use client"

import {
  Kv,
  PageHead,
  Queue,
  Section,
  Strip,
  useCounterTransition,
  usePageChrome,
} from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { StoreFileSections } from "@/lib/counter/adapters/stores"

/**
 * One store's file — `P.storecosts`.
 *
 * Read-only. Every field here is editable at `/dashboard/stores/[id]/edit`,
 * which is still the pre-Counter form; rebuilding a form is a different job
 * from rebuilding a page, and half-rebuilding one is worse than leaving it.
 * This surface's job is to show which inputs are missing and what each one
 * decides, which is what the list page links here for.
 */
export function CounterStoreFileClient({
  title,
  sections,
}: {
  title: string
  sections: SectionSources<StoreFileSections>
}) {
  usePageChrome({
    leaf: title,
    askSuggestions: [
      "What is missing from this store's file?",
      "What commission rates does this store use?",
    ],
  })
  const { pending } = useCounterTransition()

  return (
    <>
      <PageHead title={title} sub="Store file" />

      <Section bare title="The figures" data={sections.head} pending={pending}>
        {(h) => (
          <>
            <p className="mono" style={{ margin: "0 0 11px" }}>
              {h.sub}
            </p>
            <Strip cells={h.cells} />
          </>
        )}
      </Section>

      <div className="split">
        <Section
          title="Fixed cost"
          meta={(i) => i.meta}
          data={sections.inputs}
          pending={pending}
        >
          {(i) => <Kv rows={i.fixed} />}
        </Section>

        <Section
          title="Trading inputs"
          meta={() => "what the P&L reads"}
          data={sections.inputs}
          pending={pending}
        >
          {(i) => (
            <>
              <Kv rows={i.trade} />
              <p className="mono" style={{ margin: "11px 0 0" }}>
                {i.note}
              </p>
            </>
          )}
        </Section>

        <Section
          title="Where it is"
          meta={() => "for weather and event signals"}
          data={sections.inputs}
          pending={pending}
        >
          {(i) => <Kv rows={i.place} />}
        </Section>
      </div>

      <Section title="Needs you" meta={(w) => w.meta} data={sections.work} pending={pending}>
        {(w) => <Queue items={w.items} />}
      </Section>
    </>
  )
}
