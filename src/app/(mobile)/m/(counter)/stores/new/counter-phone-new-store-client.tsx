"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { MList, Section, useCounterTransition } from "@/components/counter"
import { createStoreRecord } from "@/lib/counter/actions/store"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { NewStoreSections } from "@/lib/counter/adapters/new-store"

/**
 * The create form, on a phone — `P.storeedit.phone()`.
 *
 * The masthead, the fields, and the checklist of what is still unset on the
 * stores that already exist. The desk's "What each field switches on" queue is
 * desk-only: it is three paragraphs arguing why nothing here is optional, and
 * that is a thing you read before you start rather than while you are typing.
 *
 * The FIELDS sit outside any section, exactly as `P.storeedit.phone()` puts
 * them — `.field2` carries no landmark class, and a section around three
 * inputs would be a heading over a form on a surface with no room for either.
 *
 * ## Why this exists at all, having been argued against
 *
 * `proxy.ts` carried `/dashboard/stores/new` in `NO_PHONE_PAGE` for exactly one
 * session, on the reasoning that "a four-field create form is a desk job".
 * That was wrong on the evidence: `P.storeedit` HAS a phone composition, it is
 * three fields rather than the store file's six currency inputs, and creating
 * a store is the one thing on this cluster you might genuinely do standing in
 * the new building. The entry is gone.
 */
export function CounterPhoneNewStoreClient({
  sections,
}: {
  sections: SectionSources<NewStoreSections>
}) {
  const { pending } = useCounterTransition()
  const router = useRouter()
  const [saving, startSaving] = useTransition()
  const [problem, setProblem] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")

  function create() {
    setProblem(null)
    startSaving(async () => {
      const result = await createStoreRecord({ name, address, phone: "" })
      if (!result.ok) {
        setProblem(result.error)
        return
      }
      router.push(`/m/stores/${result.storeId}`)
    })
  }

  return (
    <>
      <Section bare title="New store" data={sections.form} pending={pending}>
        {() => (
          <div>
            <h2 className="mtitle">New store</h2>
            <p className="msub">Two fields to start · the rest can wait</p>
          </div>
        )}
      </Section>

      <Section bare title="The store" data={sections.form} pending={pending}>
        {(f) => (
          <>
            <div className="field2">
              <label htmlFor="store-name">Store name</label>
              <input
                id="store-name"
                className="inp"
                type="text"
                placeholder="Glendale"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field2" style={{ marginTop: 10 }}>
              <label htmlFor="store-address">Address</label>
              <input
                id="store-address"
                className="inp"
                type="text"
                placeholder="1401 Brand Blvd"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
            {/* `.mbtn`, outside every section — the design's own shape, and no
                landmark class. Phone is desk-only: no store on this account
                has one, and it is the field the desk marks optional. */}
            <button
              className="mbtn mbtn--primary"
              type="button"
              style={{ marginTop: 12 }}
              disabled={saving || name.trim() === ""}
              onClick={create}
            >
              {saving ? "Creating…" : "Create the store"}
            </button>
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {problem === null ? f.lifecycleNote : `Could not create the store: ${problem}.`}
            </p>
          </>
        )}
      </Section>

      <Section
        title="Before it opens"
        meta={(c) => c.meta}
        data={sections.checklist}
        pending={pending}
      >
        {(c) => (
          <>
            <MList rows={c.phoneRows} />
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {c.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
