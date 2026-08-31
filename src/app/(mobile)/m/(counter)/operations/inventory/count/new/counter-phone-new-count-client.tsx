"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { MList, Section, useCounterTransition } from "@/components/counter"
import { beginStockCount } from "@/lib/counter/actions/stock-count"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { NewCountSections } from "@/lib/counter/adapters/new-count"

/**
 * Start a count, on a phone — `P.countnew.phone()`.
 *
 * One list and one button, which is the whole design: the areas that will be
 * counted, and the thing that starts it. This is the surface the desk page
 * hands over TO — "counting happens on the phone, one line at a time" — so it
 * is the one place in this wizard where the button matters more than the
 * reading.
 *
 * No toggles. The desk chooses the shape of the count; the phone is where you
 * carry it, and a switch here would be a second place to make the same
 * decision with no way to tell which one won. The list reports what is on the
 * sheet.
 *
 * The `.mbtn` sits OUTSIDE any section, exactly as `P.countnew.phone()` puts
 * it, and carries no landmark class of its own.
 */
export function CounterPhoneNewCountClient({
  sections,
  targetStoreId,
}: {
  sections: SectionSources<NewCountSections>
  targetStoreId: string | null
}) {
  const { pending } = useCounterTransition()
  const router = useRouter()
  const [busy, startBusy] = useTransition()
  const [problem, setProblem] = useState<string | null>(null)

  function begin() {
    if (targetStoreId === null) return
    setProblem(null)
    startBusy(async () => {
      const result = await beginStockCount({ storeId: targetStoreId })
      if (!result.ok) {
        setProblem(result.error)
        return
      }
      router.push(`/m/operations/inventory/counts/${result.stockCountId}`)
    })
  }

  return (
    <>
      <Section bare title="Start a count" data={sections.sheet} pending={pending}>
        {(s) => (
          <div>
            <h2 className="mtitle">Start a count</h2>
            <p className="msub">{s.meta}</p>
          </div>
        )}
      </Section>

      <Section title="Areas" meta={(g) => g.meta} data={sections.groups} pending={pending}>
        {(g) => (
          <>
            <MList rows={g.phoneRows} />
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {g.note}
            </p>
          </>
        )}
      </Section>

      <Section bare title="Begin" data={sections.open} pending={pending}>
        {(o) => (
          <>
            <button
              className="mbtn mbtn--primary"
              type="button"
              onClick={begin}
              disabled={busy || targetStoreId === null}
            >
              {busy ? "Opening…" : o.resumes ? "Resume the open count" : "Begin the count"}
            </button>
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {problem === null ? o.note : `Could not open a count: ${problem}.`}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
