"use client"

import {
  DateControl,
  Kv,
  MathLines,
  PageHead,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
} from "@/components/counter"
import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { stepRange } from "@/lib/counter/date-range"
import { saveStoreFile } from "@/lib/counter/actions/store"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
  StoreFileEditable,
  StoreFileRate,
  StoreFileSections,
} from "@/lib/counter/adapters/stores"

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

/**
 * `.editrow` — a name, its note, and the figure the owner typed.
 *
 * Not a shared primitive: the prototype emits `.editrow` inline on four pages
 * with four different column templates, and `.editrow` is not a landmark, so
 * hoisting it would buy nothing the gate can see and would fix a grid it
 * varies on purpose.
 */
function EditRows({ rows, columns }: { rows: StoreFileRate[]; columns?: string }) {
  return (
    <>
      {rows.map((r) => (
        <div className="editrow" key={r.key} style={columns ? { gridTemplateColumns: columns } : undefined}>
          <span className="nm">
            {r.label}
            {r.note ? <span>{r.note}</span> : null}
          </span>
          <span className="amt">
            {r.unitLeads ? <em>{r.unit}</em> : null}
            {r.value}
            {r.unitLeads ? null : <em>{r.unit}</em>}
          </span>
        </div>
      ))}
    </>
  )
}

/**
 * One store's file — `P.storecosts`, composed as the prototype composes it:
 *
 *   strip -> operating inputs -> split(how it reaches the P&L, location file)
 *   -> fixed expenses -> tri(commissions, targets, where it lands) -> edit.
 *
 * **The date control belongs here.** `P.storecosts` does not declare
 * `nodate`, unlike `P.stores`, because every fixed cost on the page is
 * prorated to the selected range. This page carried the store LIST's rule for
 * a while and lost three panels to it.
 *
 * **No "Needs you" queue.** The page had one; the design has none. A store
 * file states what is missing in the fields themselves — a blank rent reads as
 * a blank rent — and a queue restating that is the same fact twice.
 */
export function CounterStoreFileClient({
  title,
  params: paramsString,
  today,
  sections,
}: {
  title: string
  params: string
  today: Date
  sections: SectionSources<StoreFileSections>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  usePageChrome({
    leaf: title,
    askSuggestions: [
      "What is missing from this store's file?",
      "What commission rates does this store use?",
      "How much fixed cost lands on this range?",
    ],
  })

  const { pending, startTransition } = useCounterTransition()

  const push = useCallback(
    (next: Parameters<typeof writeCounterParams>[1]) => {
      const qs = writeCounterParams(params, next).toString()
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      })
    },
    [params, pathname, router, startTransition],
  )

  const { range, presetId, comparisonId } = counterParams

  return (
    <>
      <PageHead
        title={title}
        sub="Store file · operating inputs only you can tell us · every figure here lands on the P&L"
      >
        <DateControl
          presetId={presetId}
          comparisonId={comparisonId}
          range={range}
          onPreset={(id) => push({ presetId: id })}
          onComparison={(id) => push({ comparisonId: id })}
          onStep={(direction) => push({ range: stepRange(range, direction) })}
          onRange={(next) => push({ range: next })}
        />
      </PageHead>

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

      <Section
        title="Operating inputs"
        meta={() => "the four the P&L expects"}
        data={sections.operating}
        pending={pending}
      >
        {(o) => (
          <>
            <EditRows rows={o.rows} />
            <p className="mono" style={{ margin: "10px 0 0" }}>
              {o.note}
            </p>
          </>
        )}
      </Section>

      <div className="split">
        <Section
          title="How it reaches the P&L"
          meta={(m) => m.meta}
          data={sections.math}
          pending={pending}
        >
          {(m) => (
            <>
              <MathLines rows={m.rows} />
              <p className="mono" style={{ margin: "10px 0 0" }}>
                {m.note}
              </p>
            </>
          )}
        </Section>

        <Section
          title="Location file"
          meta={() => "used by weather and event signals"}
          data={sections.inputs}
          pending={pending}
        >
          {(i) => <Kv rows={i.place} />}
        </Section>
      </div>

      <Section
        title="Fixed expenses"
        meta={(e) => e.meta}
        data={sections.expenses}
        pending={pending}
        pad={false}
      >
        {(e) => <Table columns={e.columns} rows={e.rows} />}
      </Section>

      <div className="tri">
        <Section
          title="Platform commissions"
          meta={() => "applied to 3P gross"}
          data={sections.commissions}
          pending={pending}
        >
          {(c) => (
            <>
              <EditRows rows={c.rows} columns="1fr 86px" />
              <p className="mono" style={{ margin: "9px 0 0" }}>
                {c.note}
              </p>
            </>
          )}
        </Section>

        <Section
          title="Targets"
          meta={() => "drives the COGS band and the prime ceiling"}
          data={sections.targets}
          pending={pending}
        >
          {(t) => (
            <>
              <EditRows rows={t.rows} columns="1fr 86px" />
              <p className="mono" style={{ margin: "9px 0 0" }}>
                {t.note}
              </p>
            </>
          )}
        </Section>

        <Section
          title="Where it lands"
          meta={() => "on the P&L"}
          data={sections.lands}
          pending={pending}
        >
          {(rows) => <Kv rows={rows} />}
        </Section>
      </div>

      <Section
        title="Edit this file"
        meta={() => "every figure above comes from here"}
        data={sections.editable}
        pending={pending}
      >
        {(e) => <StoreFileForm data={e} />}
      </Section>
    </>
  )
}
