"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import {
  Note,
  PageHead,
  Queue,
  Section,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
  SubNav,
} from "@/components/counter"
import { createStoreRecord } from "@/lib/counter/actions/store"
import { storesViewTabs } from "@/lib/counter/nav"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { NewStoreSections } from "@/lib/counter/adapters/new-store"

/**
 * New store — `P.newstore`.
 *
 * Three fields, because the create action reads three. The prototype's fourth
 * — a lifecycle select — is replaced by a sentence saying every store starts
 * pre-open, which is what actually happens. See the adapter.
 *
 * Its "before opening" checklist is the account's real stores rather than the
 * prototype's six invented rows: two of them are opening, so the list is
 * useful here instead of decorative.
 */
const CHECK_COLUMNS: Column[] = [
  { key: "store", label: "Store" },
  { key: "stage", label: "Stage" },
  { key: "rent", label: "Rent", numeric: true },
  { key: "labor", label: "Fixed labor", numeric: true },
  { key: "cogs", label: "COGS target", numeric: true },
  { key: "rates", label: "Commissions" },
  { key: "otter", label: "Otter" },
  { key: "harri", label: "Harri" },
]

export function CounterNewStoreClient({
  sections,
  storeId,
}: {
  sections: SectionSources<NewStoreSections>
  storeId: string | null
}) {
  usePageChrome({
    leaf: "New store",
    askSuggestions: ["Which stores are missing a rent?", "What does a new store need?"],
  })
  const { pending } = useCounterTransition()
  const router = useRouter()

  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [phone, setPhone] = useState("")
  const [saving, startSaving] = useTransition()
  const [problem, setProblem] = useState<string | null>(null)

  function create() {
    setProblem(null)
    startSaving(async () => {
      const result = await createStoreRecord({ name, address, phone })
      if (!result.ok) {
        setProblem(result.error)
        return
      }
      router.push(`/dashboard/stores/${result.storeId}`)
    })
  }

  return (
    <>
      <PageHead title="New store" sub="Three fields to start · the rest can wait" />

      {/* `VIEWS.stores` — see `storesViewTabs` in `nav.ts`. The phone grew this
          bar first; the desk had a "New store" button on the list page and
          nothing at all on the other two, so the create form and the store file
          each sat with no way back to their siblings. Same three tabs, same
          order, one helper. */}
      <SubNav items={storesViewTabs("/dashboard/stores", storeId)} label="Stores" />

      <Section title="The store" meta={(f) => f.meta} data={sections.form} pending={pending}>
        {(f) => (
          <>
            <div className="setrow">
              <div className="tx">
                <b>Store name</b>
                <span>Required</span>
              </div>
              <input
                className="inp"
                type="text"
                aria-label="Store name"
                placeholder="Glendale"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="setrow">
              <div className="tx">
                <b>Address</b>
                <span>Recorded now, geocoded later — see below</span>
              </div>
              <input
                className="inp"
                type="text"
                aria-label="Address"
                placeholder="1401 Brand Blvd, Glendale CA"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>

            <div className="setrow">
              <div className="tx">
                <b>Phone</b>
                <span>Optional — no store on this account has one</span>
              </div>
              <input
                className="inp"
                type="tel"
                aria-label="Phone"
                placeholder="Optional"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <div className="btnrow" style={{ marginTop: 14 }}>
              <button
                className="btn btn--primary"
                type="button"
                disabled={saving || name.trim() === ""}
                onClick={create}
              >
                {saving ? "Creating…" : "Create the store"}
              </button>
              {/* `P.storeedit`'s second button, and a real one rather than a
                  shape: a form that can only be completed has no way out of
                  itself, and the destination is where the page was opened
                  from. Disabled while a create is in flight so it cannot
                  navigate away from a write it has already started. */}
              <button
                className="btn btn--quiet"
                type="button"
                disabled={saving}
                onClick={() => router.push("/dashboard/stores")}
              >
                Cancel
              </button>
            </div>

            <Note live tone={problem === null ? undefined : "bad"}>
              {problem === null ? f.lifecycleNote : `Could not create the store: ${problem}.`}
            </Note>
          </>
        )}
      </Section>

      <Section
        title="What each field switches on"
        meta={(s) => s.meta}
        data={sections.switches}
        pending={pending}
      >
        {(s) => <Queue items={s.items} />}
      </Section>

      <Section
        title="Where the stores you have stand"
        meta={(c) => c.meta}
        data={sections.checklist}
        pending={pending}
        pad={false}
        askAbout="which stores are missing a rent"
      >
        {(c) => (
          <>
            <Table columns={CHECK_COLUMNS} rows={c.rows} />
            {/* No `.sec__body` — a table section emits the table alone. */}
            <Note flush>
              {c.note}
            </Note>
          </>
        )}
      </Section>
    </>
  )
}
