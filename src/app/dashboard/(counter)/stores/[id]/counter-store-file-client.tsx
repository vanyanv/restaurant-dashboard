"use client"

import {
  Kv,
  MathLines,
  Note,
  PageHead,
  Section,
  Strip,
  useCounterTransition,
  usePageChrome,
  SubNav,
  useSurfaceHref,
} from "@/components/counter"
import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ready } from "@/lib/counter/section-data"
import { money } from "@/lib/counter/format"
import {
  addFixedExpense,
  deactivateStore,
  saveTargetCogsPct,
  editFixedExpense,
  removeFixedExpense,
  saveStoreFile,
} from "@/lib/counter/actions/store"
import { storesViewTabs } from "@/lib/counter/nav"
import { parseRatePercent } from "@/lib/counter/commission-rate-input"
import { setChecksPaused } from "@/lib/counter/actions/checks"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
  StoreFileEditable,
  StoreExpenseLine,
  StoreFileSections,
} from "@/lib/counter/adapters/stores"
import { useLeaveGuard } from "@/components/counter/keep/use-leave-guard"

/**
 * One store's file — `P.storecosts`.
 *
 * Every input is shown once, as a field, grouped the way an owner thinks
 * about them (Monthly costs, App commissions, Labor and targets, Store), with
 * one Save. The desk route and `/m/stores/[id]/edit` both render this.
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

/** A stored fraction as the percent the form edits; blank for "not known". */
const pctField = (v: number | null): string => (v === null ? "" : String(Math.round(v * 1000) / 10))

/** The payroll tax rate to the hundredth of a percent — 7.65, not 7.7. */
const pct2Field = (v: number | null): string => (v === null ? "" : String(Math.round(v * 10000) / 100))

/**
 * The five commission settings, in the order the Delivery commission table
 * lists them. Delivery rates are required columns (a blank is an error); the pickup and Grubhub rates may be cleared, which the P&L reads as
 * "not known" rather than free.
 */
const RATE_FIELDS = [
  { key: "doordash" as const, label: "DoorDash delivery", required: true },
  { key: "doordashPickup" as const, label: "DoorDash pickup", required: false },
  { key: "uber" as const, label: "Uber Eats delivery", required: true },
  { key: "uberPickup" as const, label: "Uber Eats pickup", required: false },
  { key: "grubhub" as const, label: "Grubhub", required: false },
]

const STAGES = [
  { value: "pre_open" as const, label: "Pre-open" },
  { value: "warming_up" as const, label: "Warming up" },
  { value: "ready" as const, label: "Open" },
]

const MONEY_FIELDS = [
  { key: "rent" as const, label: "Monthly rent", hint: "Prorates into every P&L period" },
  { key: "labor" as const, label: "Fixed monthly labor", hint: "Salaried cost the schedule never sees" },
  { key: "cleaning" as const, label: "Monthly cleaning", hint: "Recurring deep-clean service" },
  { key: "towels" as const, label: "Monthly linen", hint: "Entered here as a month, billed weekly" },
]

/**
 * The store file's write path — the four fixed costs and the two commission
 * rates. The editorial build had these on a separate `/edit` route the
 * prototype never had; `P.storefile` is one page, and it is this one.
 *
 * THE COGS TARGET IS EDITABLE NOW, AND THIS COMMENT USED TO SAY IT COULD NOT
 * BE. It read: "shown and not editable: `updateStoreSchema` does not accept
 * `targetCogsPct`, so a field for it would save nothing." True about
 * `updateStore`, and wrong about the product — `setStoreTargetCogsPct` is its
 * own owner-gated action, has existed the whole time, and the editorial COGS
 * page called it. Saving therefore makes TWO writes behind one press, because
 * there are genuinely two actions; see `save`.
 *
 * It matters more than a field: the target is the line every food-cost chart
 * is drawn against, and of this account's three stores only Hollywood had one.
 * Glendale and Van Nuys were both null, so their charts had no plan to be over
 * or under and no screen could give them one.
 */
function StoreFileForm({
  data,
  picked,
  onPick,
}: {
  data: StoreFileEditable
  picked: string | null
  onPick: (id: string | null) => void
}) {
  const surface = useSurfaceHref()
  const router = useRouter()
  const formOf = (d: StoreFileEditable) => ({
    rent: fieldOf(d.rent),
    labor: fieldOf(d.labor),
    cleaning: fieldOf(d.cleaning),
    towels: fieldOf(d.towels),
    uber: pctField(d.uber),
    doordash: pctField(d.doordash),
    uberPickup: pctField(d.uberPickup),
    doordashPickup: pctField(d.doordashPickup),
    grubhub: pctField(d.grubhub),
    payrollTax: pct2Field(d.payrollTax),
    stage: d.stage,
  })
  const [form, setForm] = useState(() => formOf(data))
  // Its own field, because it has its own action. See `saveTargetCogsPct`.
  const [target, setTarget] = useState(
    data.cogsTarget === null ? "" : String(data.cogsTarget),
  )
  const [saving, startSaving] = useTransition()
  // The outcome travels with the text — see the same note in Settings.
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    setForm(formOf(data))
  }, [
    data.rent, data.labor, data.cleaning, data.towels, data.uber, data.doordash,
    data.uberPickup, data.doordashPickup, data.grubhub, data.payrollTax, data.stage,
  ])

  useEffect(() => {
    setTarget(data.cogsTarget === null ? "" : String(data.cogsTarget))
  }, [data.cogsTarget])

  // Ask before leaving with store settings typed but not saved.
  useLeaveGuard(
    JSON.stringify(form) !== JSON.stringify(formOf(data)) ||
      target !== (data.cogsTarget === null ? "" : String(data.cogsTarget)),
  )

  function save() {
    setSaid(null)
    // Every rate checked before anything is sent: a typo is an error on the
    // page, never a silently cleared or rescaled rate.
    const rates = {} as Record<(typeof RATE_FIELDS)[number]["key"], number | null>
    for (const f of RATE_FIELDS) {
      const r = parseRatePercent(form[f.key], f.label, { required: f.required })
      if (!r.ok) {
        setSaid({ ok: false, text: `${r.error}.` })
        return
      }
      rates[f.key] = r.value
    }
    const tax = parseRatePercent(form.payrollTax, "Employer payroll tax", { required: false })
    if (!tax.ok) {
      setSaid({ ok: false, text: `${tax.error}.` })
      return
    }
    startSaving(async () => {
      const result = await saveStoreFile(data.storeId, {
        name: data.name,
        address: null,
        phone: null,
        fixedMonthlyRent: numberOf(form.rent),
        fixedMonthlyLabor: numberOf(form.labor),
        fixedMonthlyTowels: numberOf(form.towels),
        fixedMonthlyCleaning: numberOf(form.cleaning),
        // Required fields: `parseRatePercent` has already refused a blank.
        uberCommissionRate: rates.uber ?? data.uber * 100,
        doordashCommissionRate: rates.doordash ?? data.doordash * 100,
        uberPickupCommissionRate: rates.uberPickup,
        doordashPickupCommissionRate: rates.doordashPickup,
        grubhubCommissionRate: rates.grubhub,
        employerPayrollTaxRate: tax.value,
        ...(form.stage !== data.stage ? { lifecycleStage: form.stage } : {}),
      })
      if (!result.ok) {
        setSaid({ ok: false, text: `Could not save: ${result.error}.` })
        return
      }
      /*
       * The target is a SECOND write, because it is a second action —
       * `updateStore` genuinely does not accept `targetCogsPct` and
       * `setStoreTargetCogsPct` genuinely does. One press, so the reader never
       * has to know there are two; a blank box clears the target rather than
       * setting it to zero, which are different things to draw a chart
       * against.
       */
      const trimmed = target.trim()
      const wanted = trimmed === "" ? null : Number(trimmed)
      if (wanted !== null && (!Number.isFinite(wanted) || wanted < 0 || wanted > 100)) {
        setSaid({ ok: false, text: "The food-cost target must be a percent between 0 and 100." })
        return
      }
      if (wanted !== data.cogsTarget) {
        const t = await saveTargetCogsPct(data.storeId, wanted)
        if (!t.ok) {
          setSaid({ ok: false, text: `Inputs saved, but the target did not: ${t.error}.` })
          return
        }
      }
      setSaid({ ok: true, text: "Saved." })
      router.refresh()
    })
  }

  /*
   * Deactivating navigates AWAY rather than refreshing. The store-file loader
   * reads `where: { isActive: true }`, so the moment this succeeds there is no
   * file at this route to re-render — staying here would show the reader an
   * error for a thing that worked.
   */
  const deactivate = () => {
    setSaid(null)
    startSaving(async () => {
      const result = await deactivateStore(data.storeId)
      if (!result.ok) {
        setSaid({ ok: false, text: result.error })
        return
      }
      router.push(surface("/dashboard/stores"))
    })
  }

  /*
   * ONE LIST, EACH INPUT ONCE (design review, 2026-11-11).
   *
   * The page used to show every input twice: read-only "Operating inputs",
   * "Delivery commission" and "Targets" panels that looked like fields, then
   * "Edit this file" with the real fields at the bottom. On a phone that was
   * 4,475 px, and owners tapped the read-only copies first. Now the fields ARE
   * the page, grouped the way an owner thinks about them, with one Save.
   *
   * Each group is its own `Section` over the one `editable` value it was
   * handed, so the groups get the Counter section frame without a second
   * load. Fixed-expense lines sit in Monthly costs, beside rent, because
   * that is where an owner looks for a recurring bill.
   */
  const loaded = ready(data)
  const rateInput = (key: (typeof RATE_FIELDS)[number]["key"], label: string, required: boolean) => (
    <input
      className="inp storefile__num"
      type="number"
      min="0"
      max="100"
      step="0.1"
      inputMode="decimal"
      aria-label={`${label} commission percent`}
      placeholder={required ? undefined : "Not known"}
      value={form[key]}
      onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
    />
  )

  return (
    <>
      <Section title="Monthly costs" meta={() => "spread across the days on the P&L"} data={loaded}>
        {() => (
          <>
            {MONEY_FIELDS.map((f) => (
              <div className="setrow" key={f.key}>
                <div className="tx">
                  <b>{f.label}</b>
                  <span>{f.hint}</span>
                </div>
                <input
                  className="inp storefile__num"
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
            <ExpenseEditor
              storeId={data.storeId}
              lines={data.expenseLines}
              picked={picked}
              onPick={onPick}
            />
          </>
        )}
      </Section>

      <Section title="App commissions" meta={() => "percent of the price after discounts"} data={loaded}>
        {() => (
          <>
            {RATE_FIELDS.map((f) => (
              <div className="setrow" key={f.key}>
                <div className="tx">
                  <b>{f.label}</b>
                  <span>{data.observed[f.key]}</span>
                </div>
                {rateInput(f.key, f.label, f.required)}
              </div>
            ))}
          </>
        )}
      </Section>

      <Section title="Labor and targets" data={loaded}>
        {() => (
          <>
            {/* Employer payroll tax: loaded onto Harri wages in every labor figure. */}
            <div className="setrow">
              <div className="tx">
                <b>Employer payroll tax</b>
                <span>Added to Harri wages. 7.65% is the federal share; add your California rates. Blank adds none.</span>
              </div>
              <input
                className="inp storefile__num"
                type="number"
                min="0"
                max="100"
                step="0.01"
                inputMode="decimal"
                aria-label="Employer payroll tax percent"
                placeholder="None"
                value={form.payrollTax}
                onChange={(e) => setForm((p) => ({ ...p, payrollTax: e.target.value }))}
              />
            </div>
            {/* `.setrow`, not `.editrow` — see the history of this row in git:
                borrowed `.editrow` once rendered its label and hint on one
                italic line over an unboxed number. */}
            <div className="setrow">
              <div className="tx">
                <b>Food-cost target</b>
                <span>The plan line on food-cost charts. Blank means no plan, not zero.</span>
              </div>
              <input
                className="inp storefile__num"
                type="number"
                min="0"
                max="100"
                step="0.1"
                inputMode="decimal"
                aria-label="Food cost target percent"
                placeholder="No plan"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </div>
          </>
        )}
      </Section>

      <Section title="Store" data={loaded}>
        {() => (
          <>
            {/* Lifecycle: what the nightly model and every "trading" badge read. */}
            <div className="setrow">
              <div className="tx">
                <b>Stage</b>
                <span>Pre-open skips forecasts and syncs. Open is a trading store.</span>
              </div>
              <select
                className="fld"
                value={form.stage}
                aria-label="Lifecycle stage"
                onChange={(e) =>
                  setForm((p) => ({ ...p, stage: e.target.value as StoreFileEditable["stage"] }))
                }
              >
                {STAGES.map((st) => (
                  <option key={st.value} value={st.value}>
                    {st.label}
                  </option>
                ))}
              </select>
            </div>

            <ChecksPauseRow storeId={data.storeId} since={data.checksPausedSince} />

            {/* `P.storecosts` draws "Deactivate this store" and "Delete" side
                by side. In this codebase those are ONE operation:
                `deleteStore` sets `isActive: false` and touches nothing else.
                So one button, named for what actually happens. See
                `deactivateStore`. It is a row here, away from Save, so the
                two are never pressed for each other. */}
            <div className="setrow">
              <div className="tx">
                <b>Deactivate this store</b>
                <span>Hides it from every page. Its history stays.</span>
              </div>
              <button className="btn" type="button" disabled={saving} onClick={deactivate}>
                Deactivate
              </button>
            </div>
          </>
        )}
      </Section>

      <div className="btnrow storefile__save">
        <button className="btn btn--primary" type="button" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      <Note live={said !== null} tone={said === null ? undefined : said.ok ? "good" : "bad"}>
        {said?.text ??
          "Save changes keeps every cost, commission, payroll tax, target and stage above. Type 25 for 25%."}
      </Note>
    </>
  )
}

/**
 * Store checks on or paused, for training crew. Its own button rather than a
 * field under "Save the inputs": pausing is an immediate switch the owner
 * flips at the store, and resuming clears the practice ticks, so it should
 * never ride along with an unrelated save.
 */
function ChecksPauseRow({ storeId, since }: { storeId: string; since: string | null }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const paused = since !== null
  const flip = () => {
    setError(null)
    start(async () => {
      const r = await setChecksPaused({ storeId, paused: !paused })
      if (!r.ok) setError(r.error)
      else router.refresh()
    })
  }
  return (
    <div className="setrow">
      <div className="tx">
        <b>Store checks{paused ? " \u00b7 paused" : ""}</b>
        <span>
          {error ??
            (paused
              ? `Paused since ${since} for training. Nothing counts as missed or late, and the crew page is practice only. Resuming clears the practice ticks.`
              : "Pause while you teach crew the checks. Nothing counts as missed or late until you resume.")}
        </span>
      </div>
      <button
        className={paused ? "btn btn--primary" : "btn"}
        type="button"
        disabled={busy}
        aria-pressed={paused}
        onClick={flip}
      >
        {busy ? (paused ? "Resuming\u2026" : "Pausing\u2026") : paused ? "Resume checks" : "Pause checks"}
      </button>
    </div>
  )
}

/**
 * ADDING, EDITING AND REMOVING A FIXED EXPENSE.
 *
 * `P.storecosts` draws this as a `.setrow` in "Edit this file": "Add a fixed
 * expense — name, amount and cadence, weekly, monthly or annual. It becomes
 * its own P&L row", with an "Add a line" button beside it.
 *
 * `e2e/fidelity/manifest.ts` declared that button absent because "nothing
 * writes `StoreFixedExpense`, `prisma.storeFixedExpense.create` appears
 * nowhere outside the generated client". That was not true — it is checked
 * again in the commit that adds this — and the allowance is corrected there.
 * `src/app/actions/store/fixed-expense-actions.ts` has owner-gated create,
 * update and delete, and the editorial store dossier called all three.
 *
 * **Each line becomes its own P&L row**, which is why the gap mattered more
 * than its size: a rent nobody can enter is a P&L understated by the rent,
 * every month, with nothing on screen to notice.
 *
 * ## ONE FORM, TWO JOBS
 *
 * Selecting a row in the table above loads it here and the primary becomes
 * "Save this line"; with nothing selected it adds. That is one control set
 * rather than a button per row — the table has as many rows as the owner has
 * expenses, and a per-row pair is a landmark count that changes every time
 * they add one, which is a count no fidelity allowance can name. The alert
 * inbox reached the same shape from the same direction.
 *
 * "Remove this line" is a real delete rather than a deactivation, because
 * `deleteStoreFixedExpense` is one, and it is disabled with nothing selected
 * rather than hidden: the prototype ships a disabled `.btn` on the invoice
 * page for the same reason, and a control that vanishes is one the reader has
 * to rediscover.
 */
function ExpenseEditor({
  storeId,
  lines,
  picked,
  onPick,
}: {
  storeId: string
  lines: StoreExpenseLine[]
  picked: string | null
  onPick: (id: string | null) => void
}) {
  const router = useRouter()
  const [saving, startSaving] = useTransition()
  const selected = picked
  const setSelected = onPick
  const [label, setLabel] = useState("")
  const [amount, setAmount] = useState("")
  const [frequency, setFrequency] = useState<"WEEKLY" | "MONTHLY" | "YEARLY">("MONTHLY")
  const [said, setSaid] = useState<string | null>(null)

  /*
   * The selection lives in the PARENT, because the table that sets it is
   * rendered by the parent from a different section. This mirrors the picked
   * line's own values down into the three fields whenever it changes, and
   * clears them when it is dropped — so pressing a row in the table above
   * fills the form, and saving (which clears the selection) empties it back to
   * the add case.
   */
  const lastPicked = useRef<string | null>(null)
  useEffect(() => {
    if (lastPicked.current === picked) return
    lastPicked.current = picked
    const line = picked === null ? null : lines.find((l) => l.id === picked)
    setLabel(line?.label ?? "")
    setAmount(line === null || line === undefined ? "" : String(line.amount))
    setFrequency(line?.frequency ?? "MONTHLY")
    setSaid(null)
  }, [picked, lines])

  const clear = () => {
    setSelected(null)
    setLabel("")
    setAmount("")
    setFrequency("MONTHLY")
  }

  const submit = () => {
    const value = Number(amount.trim())
    /*
     * THREE FAILURES, THREE SENTENCES.
     *
     * All three used to answer "A line needs a name and an amount." — which is
     * true of the first two and false of the third: a line entered as
     * "Insurance / -50" HAS a name and HAS an amount, and the reader was told
     * to supply what they had just supplied. The one thing wrong with it, the
     * minus sign, was the one thing not mentioned.
     */
    if (label.trim() === "") {
      setSaid("A line needs a name.")
      return
    }
    if (amount.trim() === "" || !Number.isFinite(value)) {
      setSaid("A line needs an amount, as a number.")
      return
    }
    if (value < 0) {
      setSaid("An amount cannot be negative — this is a cost, and the P&L subtracts it.")
      return
    }
    setSaid(null)
    startSaving(async () => {
      const result = selected
        ? await editFixedExpense({ id: selected, label: label.trim(), amount: value, frequency })
        : await addFixedExpense({
            storeId,
            label: label.trim(),
            amount: value,
            frequency,
          })
      if (!result.ok) {
        setSaid(result.error)
        return
      }
      clear()
      // The table above, the monthly total, and every P&L that reads fixed
      // cost all move together.
      router.refresh()
    })
  }

  const remove = () => {
    if (!selected) return
    setSaid(null)
    startSaving(async () => {
      const result = await removeFixedExpense(selected)
      if (!result.ok) {
        setSaid(result.error)
        return
      }
      clear()
      router.refresh()
    })
  }

  /* A FRAGMENT, NOT A `.sec__body`. `P.storecosts` wraps the whole of "Edit
     this file" in ONE `.sec__body` — setrows, the button row and the callout
     together — and this editor renders inside the form that already sits in
     it. A second one is an extra landmark and, worse, a second inset around
     content that is already inset. The gate caught it. */
  /* A FRAGMENT, NOT A `.sec__body`: this renders inside the Monthly costs
     section, which already has one. A second is a second inset. */
  return (
    <>
      {lines.map((l) => (
        <button
          type="button"
          key={l.id}
          className={l.id === selected ? "setrow setrow--pick is-on" : "setrow setrow--pick"}
          aria-pressed={l.id === selected}
          onClick={() => setSelected(l.id === selected ? null : l.id)}
        >
          <span className="tx">
            <b>{l.label}</b>
            <span>
              {l.frequency === "MONTHLY"
                ? "Monthly"
                : `${l.frequency === "WEEKLY" ? "Weekly" : "Yearly"} ${money(l.amount)}`}
              {" · tap to change"}
            </span>
          </span>
          <span className="setrow__val">{money(l.monthly)}/mo</span>
        </button>
      ))}

      <div className="setrow setrow--stack">
        <div className="tx">
          <b>{selected ? "Change this cost" : "Add another monthly cost"}</b>
          <span>
            {selected
              ? "Change it and save, or remove it. Past P&L periods recompute from what remains."
              : "Insurance, software, a loan payment. Each one becomes its own P&L line."}
          </span>
        </div>
        <div className="storefile__exp">
          <input
            className="fld"
            type="text"
            value={label}
            placeholder="Name"
            aria-label="Expense name"
            onChange={(e) => setLabel(e.target.value)}
          />
          <input
            className="fld"
            type="text"
            inputMode="decimal"
            value={amount}
            placeholder="Amount"
            aria-label="Expense amount"
            onChange={(e) => setAmount(e.target.value)}
          />
          <select
            className="fld"
            value={frequency}
            aria-label="How often"
            onChange={(e) =>
              setFrequency(e.target.value as "WEEKLY" | "MONTHLY" | "YEARLY")
            }
          >
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
          </select>
        </div>
        <div className="btnrow">
          <button className="btn" type="button" disabled={saving} onClick={submit}>
            {saving ? "Saving…" : selected ? "Save this cost" : "Add it"}
          </button>
          {selected ? (
            <button className="btn" type="button" disabled={saving} onClick={remove}>
              Remove it
            </button>
          ) : null}
        </div>
      </div>

      {said ? <Note tone="bad">{said}</Note> : null}
    </>
  )
}

/**
 * One store's file — `P.storecosts`, rebuilt after the 2026-11-11 design
 * review as the owner reads it:
 *
 *   strip -> monthly costs -> app commissions -> labor and targets -> store
 *   -> save -> folded "how this is worked out" (math, where it lands, place).
 *
 * **No date control.** The prototype had one because the math panel prorates
 * fixed cost to a range. That panel is now a fold an owner opens on purpose,
 * and a date picker on a settings page read as "these settings change by
 * date", which they do not. The math still uses the URL's range (the default
 * when there is none) and says how many days it covers.
 *
 * **No "Needs you" queue.** A store file states what is missing in the fields
 * themselves — a blank rent reads as a blank rent.
 */
export function CounterStoreFileClient({
  title,
  storeId,
  sections,
}: {
  title: string
  /* The ROUTE's id, not `data.storeId`: the bar is drawn before the sections
     resolve, and a tab that appears a beat late is a tab that moves under the
     pointer. */
  storeId: string
  params: string
  today: Date
  sections: SectionSources<StoreFileSections>
}) {
  const surface = useSurfaceHref()

  usePageChrome({
    leaf: title,
    askSuggestions: [
      "What is missing from this store's file?",
      "What commission rates does this store use?",
      "How much fixed cost lands on this range?",
    ],
  })

  const { pending } = useCounterTransition()

  // Which fixed-expense line the editor is holding. Component state rather
  // than the URL: a half-finished edit is not a thing worth linking to.
  const [pickedExpense, setPickedExpense] = useState<string | null>(null)

  return (
    <>
      <PageHead
        title={title}
        sub="Store file · the costs and rates only you can tell us. Every number here feeds the P&L."
      />

      {/* `VIEWS.stores` — see `storesViewTabs` in `nav.ts`. */}
      <SubNav items={storesViewTabs("/dashboard/stores", storeId).map((t) => ({ ...t, href: surface(t.href) }))} label="Stores" />

      <Section bare title="The figures" data={sections.head} pending={pending}>
        {(h) => (
          <>
            <Note lede>
              {h.sub}
            </Note>
            <Strip cells={h.cells} />
          </>
        )}
      </Section>

      <Section bare title="Your inputs" data={sections.editable} pending={pending}>
        {(e) => (
          <StoreFileForm data={e} picked={pickedExpense} onPick={setPickedExpense} />
        )}
      </Section>

      <Section
        title="How this is worked out"
        meta={(m) => m.meta}
        data={sections.math}
        pending={pending}
        fold="closed"
      >
        {(m) => (
          <>
            <MathLines rows={m.rows} />
            <Note>
              {m.note}
            </Note>
          </>
        )}
      </Section>

      <Section
        title="Where each input lands"
        meta={() => "on the P&L"}
        data={sections.lands}
        pending={pending}
        fold="closed"
      >
        {(rows) => <Kv rows={rows} />}
      </Section>

      <Section
        title="Location"
        meta={(i) => i.placeMeta}
        data={sections.inputs}
        pending={pending}
        fold="closed"
      >
        {(i) => <Kv rows={i.place} />}
      </Section>
    </>
  )
}
