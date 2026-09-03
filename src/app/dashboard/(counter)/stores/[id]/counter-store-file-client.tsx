"use client"

import {
  DateControl,
  Kv,
  MathLines,
  Note,
  PageHead,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Row,
  SubNav,
} from "@/components/counter"
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { stepRange } from "@/lib/counter/date-range"
import {
  addFixedExpense,
  deactivateStore,
  saveTargetCogsPct,
  editFixedExpense,
  removeFixedExpense,
  saveStoreFile,
} from "@/lib/counter/actions/store"
import { storesViewTabs } from "@/lib/counter/nav"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
  StoreFileEditable,
  StoreExpenseLine,
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
  const router = useRouter()
  const [form, setForm] = useState({
    rent: fieldOf(data.rent),
    labor: fieldOf(data.labor),
    cleaning: fieldOf(data.cleaning),
    towels: fieldOf(data.towels),
    uber: String(Math.round(data.uber * 1000) / 10),
    doordash: String(Math.round(data.doordash * 1000) / 10),
  })
  // Its own field, because it has its own action. See `saveTargetCogsPct`.
  const [target, setTarget] = useState(
    data.cogsTarget === null ? "" : String(data.cogsTarget),
  )
  const [saving, startSaving] = useTransition()
  // The outcome travels with the text — see the same note in Settings.
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)

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

  useEffect(() => {
    setTarget(data.cogsTarget === null ? "" : String(data.cogsTarget))
  }, [data.cogsTarget])

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
      router.push("/dashboard/stores")
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

      {/*
        * `.setrow`, like the five fields above it — not `.editrow`.
        *
        * `.editrow` is the expense table's row: a four-column grid
        * (`1fr 118px 96px auto`) for a name, an amount, a cadence and a
        * button. Borrowed here it had to be overridden inline to two columns,
        * its `.nm > em` description renders INLINE where `.setrow span` is
        * `display:block`, and `.fld` carries no border where `.inp` does. So
        * the one row on this form that sets the food-cost target read
        * "Food-cost targetThe plan line on every food-cost chart for this
        * store" on a single line, in italic, over a bare unboxed number —
        * beside five siblings with a bold label, a grey line under it and a
        * bordered field.
        */}
      <div className="setrow">
        <div className="tx">
          <b>Food-cost target</b>
          <span>The plan line on every food-cost chart for this store</span>
        </div>
        <input
          className="inp"
          type="number"
          min="0"
          max="100"
          step="0.1"
          inputMode="decimal"
          aria-label="Food cost target percent"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
      </div>

      <ExpenseEditor
        storeId={data.storeId}
        lines={data.expenseLines}
        picked={picked}
        onPick={onPick}
      />

      <div className="btnrow" style={{ marginTop: 12 }}>
        <button className="btn btn--primary" type="button" disabled={saving} onClick={save}>
          {saving ? "Saving\u2026" : "Save the inputs"}
        </button>
        {/* `P.storecosts` draws "Deactivate this store" and "Delete" side by
            side and then explains underneath that "deleting a store does not
            delete its history". In this codebase those are ONE operation:
            `deleteStore` sets `isActive: false` and touches nothing else. So
            one button, named for what actually happens. See
            `deactivateStore`. */}
        <button
          className="btn"
          type="button"
          disabled={saving}
          onClick={deactivate}
        >
          Deactivate this store
        </button>
      </div>

      <Note live={said !== null} tone={said === null ? undefined : said.ok ? "good" : "bad"}>
        {said?.text ??
          `Commissions are percentages \u2014 21 and 0.21 both mean 21%. The food-cost target is ` +
            `the line every food-cost chart for this store is drawn against; leave it blank for ` +
            `no plan, which is not the same as a plan of zero.`}
      </Note>
    </>
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
  return (
    <>
      <div className="setrow">
        <div className="tx">
          <b>{selected ? "Edit this fixed expense" : "Add a fixed expense"}</b>
          <span>
            Name, amount and cadence — weekly, monthly or yearly. It becomes its own
            P&amp;L row. Press a line in the table above to edit it instead.
          </span>
        </div>
        <button className="btn" type="button" disabled={saving} onClick={submit}>
          {saving ? "Saving…" : selected ? "Save this line" : "Add a line"}
        </button>
      </div>

      <div className="editrow" style={{ gridTemplateColumns: "1fr 120px 120px" }}>
        <input
          className="fld"
          type="text"
          value={label}
          placeholder="Rent, fixed labor, towels…"
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
          aria-label="Cadence"
          onChange={(e) =>
            setFrequency(e.target.value as "WEEKLY" | "MONTHLY" | "YEARLY")
          }
        >
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="YEARLY">Yearly</option>
        </select>
      </div>

      <div className="setrow">
        <div className="tx">
          <b>Remove a fixed expense</b>
          <span>
            {selected
              ? "This deletes the line. The P&L rows it produced in past periods are recomputed from the lines that remain."
              : "Press a line in the table above to select it."}
          </span>
        </div>
        <button
          className="btn"
          type="button"
          disabled={saving || selected === null}
          onClick={remove}
        >
          Remove this line
        </button>
      </div>

      {said ? <Note tone="bad">{said}</Note> : null}
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
  storeId,
  params: paramsString,
  today,
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

  // Which fixed-expense line the editor below is holding. Component state
  // rather than the URL: unlike the alert inbox's selection this is a
  // half-finished edit, not a thing worth linking someone to.
  const [pickedExpense, setPickedExpense] = useState<string | null>(null)

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

      {/* `VIEWS.stores` — see `storesViewTabs` in `nav.ts`. The phone grew this
          bar first; the desk had a "New store" button on the list page and
          nothing at all on the other two, so the create form and the store file
          each sat with no way back to their siblings. Same three tabs, same
          order, one helper. */}
      <SubNav items={storesViewTabs("/dashboard/stores", storeId)} label="Stores" />

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

      <Section
        title="Operating inputs"
        meta={() => "the four the P&L expects"}
        data={sections.operating}
        pending={pending}
      >
        {(o) => (
          <>
            <EditRows rows={o.rows} />
            <Note>
              {o.note}
            </Note>
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
              <Note>
                {m.note}
              </Note>
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
        {(e) => (
          <Table
            columns={e.columns}
            // Pressable so one row can be loaded into the editor below. The
            // rows carried no affordance at all before — see `ExpenseEditor`
            // for why the controls are one set down there rather than a pair
            // on every row.
            rows={e.rows.map(
              // Rebuilt rather than spread: `Row` forbids `href` and
              // `onSelect` together, and a spread of the union carries a
              // possible `href` that TypeScript cannot narrow away. Expense
              // rows have no destination, so key and cells are all there is.
              (r): Row => ({
                key: r.key,
                cells: r.cells,
                onSelect: () => setPickedExpense(r.key),
                selected: r.key === pickedExpense,
              }),
            )}
          />
        )}
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
              <Note>
                {c.note}
              </Note>
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
              <Note>
                {t.note}
              </Note>
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
        {(e) => (
          <StoreFileForm data={e} picked={pickedExpense} onPick={setPickedExpense} />
        )}
      </Section>
    </>
  )
}
