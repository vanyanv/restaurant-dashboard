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
import { useEffect, useState, useTransition } from "react"
import { saveStoreFile } from "@/lib/counter/actions/store"
import type { StoreFileEditable } from "@/lib/counter/adapters/stores"
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

/** A number field that keeps a blank blank rather than turning it into zero. */
function fieldOf(v: number | null): string {
  // Linen is stored as a weekly charge converted to a month, so it arrives as
  // 238.33333333333334. A form field is for typing in, not for showing every
  // bit of a float.
  if (v === null) return ""
  return String(Math.round(v * 100) / 100)
}

function numberOf(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === "") return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

const MONEY_FIELDS = [
  { key: "rent" as const, label: "Monthly rent", hint: "Prorates into every P&L period" },
  { key: "labor" as const, label: "Fixed monthly labour", hint: "Salaried cost the schedule never sees" },
  { key: "cleaning" as const, label: "Monthly cleaning", hint: "Recurring deep-clean service" },
  { key: "towels" as const, label: "Monthly linen", hint: "Entered here as a month, billed weekly" },
]

/**
 * The store file's write path — the four fixed costs and the two commission
 * rates. The editorial build had these on a separate `/edit` route the
 * prototype never had; `P.storefile` is one page, and it is this one.
 *
 * The COGS target is shown and not editable: `updateStoreSchema` in
 * `@/app/actions/store/crud-actions` does not accept `targetCogsPct`, so a
 * field for it would save nothing.
 */
function StoreFileForm({ data }: { data: StoreFileEditable }) {
  const [form, setForm] = useState({
    rent: fieldOf(data.rent),
    labor: fieldOf(data.labor),
    cleaning: fieldOf(data.cleaning),
    towels: fieldOf(data.towels),
    uber: String(Math.round(data.uber * 1000) / 10),
    doordash: String(Math.round(data.doordash * 1000) / 10),
  })
  const [saving, startSaving] = useTransition()
  const [said, setSaid] = useState<string | null>(null)

  useEffect(() => {
    setForm({
      rent: fieldOf(data.rent),
      labor: fieldOf(data.labor),
      cleaning: fieldOf(data.cleaning),
      towels: fieldOf(data.towels),
      uber: String(Math.round(data.uber * 1000) / 10),
      doordash: String(Math.round(data.doordash * 1000) / 10),
    })
  }, [data.rent, data.labor, data.cleaning, data.towels, data.uber, data.doordash])

  function save() {
    setSaid(null)
    startSaving(async () => {
      const result = await saveStoreFile(data.storeId, {
        name: data.name,
        address: null,
        phone: null,
        fixedMonthlyRent: numberOf(form.rent),
        fixedMonthlyLabor: numberOf(form.labor),
        fixedMonthlyTowels: numberOf(form.towels),
        fixedMonthlyCleaning: numberOf(form.cleaning),
        uberCommissionRate: numberOf(form.uber) ?? data.uber * 100,
        doordashCommissionRate: numberOf(form.doordash) ?? data.doordash * 100,
      })
      setSaid(result.ok ? "Saved." : `Could not save: ${result.error}.`)
    })
  }

  return (
    <>
      {MONEY_FIELDS.map((f) => (
        <div className="setrow" key={f.key}>
          <div className="tx">
            <b>{f.label}</b>
            <span>{f.hint}</span>
          </div>
          <input
            className="inp"
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            aria-label={f.label}
            placeholder="Not set"
            value={form[f.key]}
            onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
          />
        </div>
      ))}

      <div className="setrow">
        <div className="tx">
          <b>Uber Eats commission</b>
          <span>Applied to third-party gross on the P&amp;L</span>
        </div>
        <input
          className="inp"
          type="number"
          min="0"
          max="100"
          step="0.1"
          inputMode="decimal"
          aria-label="Uber Eats commission percent"
          value={form.uber}
          onChange={(e) => setForm((p) => ({ ...p, uber: e.target.value }))}
        />
      </div>

      <div className="setrow">
        <div className="tx">
          <b>DoorDash commission</b>
          <span>Applied to third-party gross on the P&amp;L</span>
        </div>
        <input
          className="inp"
          type="number"
          min="0"
          max="100"
          step="0.1"
          inputMode="decimal"
          aria-label="DoorDash commission percent"
          value={form.doordash}
          onChange={(e) => setForm((p) => ({ ...p, doordash: e.target.value }))}
        />
      </div>

      <div className="btnrow" style={{ marginTop: 12 }}>
        <button className="btn btn--primary" type="button" disabled={saving} onClick={save}>
          {saving ? "Saving\u2026" : "Save the inputs"}
        </button>
      </div>

      <p className="mono" style={{ margin: "10px 0 0" }}>
        {said ??
          `Commissions are percentages \u2014 21 and 0.21 both mean 21%. The COGS target ` +
            `${data.cogsTarget === null ? "is not set" : `reads ${data.cogsTarget}%`} and is not ` +
            `editable here: the update action does not accept targetCogsPct, so a field for it ` +
            `would save nothing.`}
      </p>
    </>
  )
}

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

      <Section
        title="Set the inputs"
        meta={() => "what lands on the P&L"}
        data={sections.editable}
        pending={pending}
      >
        {(e) => <StoreFileForm data={e} />}
      </Section>

      <Section title="Needs you" meta={(w) => w.meta} data={sections.work} pending={pending}>
        {(w) => <Queue items={w.items} />}
      </Section>
    </>
  )
}
