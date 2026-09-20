"use client"

import { useCallback, useMemo, useState, useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  DateControl,
  Note,
  PageHead,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
  type SwitchableStore,
} from "@/components/counter"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { IngredientCost, IngredientSections } from "@/lib/counter/adapters/ingredient"
import { saveIngredientCost } from "@/lib/counter/actions/ingredient"

/**
 * One ingredient, composed from `P.ingredient.desk()`
 * (`docs/counter/counter-prototype.html:7024`) in the prototype's own order:
 *
 *   strip -> price history -> a split of matched SKUs and used-in.
 *
 * Two sections are OURS and not the prototype's: "Deliveries", between the
 * price history and the split, and "What this costs" at the foot. Each is
 * argued where it is built — `deliveriesOf` and `costOf` in the adapter.
 * `e2e/fidelity/manifest.ts` carries the extra-landmark allowance for the
 * cost form; "Deliveries" adds one `.sec`, one `.sec__head` and one `.tbl`
 * on top of that and has no allowance yet, so `npm run fidelity` reports
 * three unexplained extras on this route until one is measured and written.
 *
 * The adapter's docblock argues the departures. Two of the five strip cells
 * and one table column describe data this account does not have — there is no
 * on-hand figure for anything, and `IngredientSkuMatch` has no confidence
 * column — and the prototype's whole narrative is an ingredient getting more
 * expensive, where this one got cheaper.
 */
export type CounterIngredientSections = SectionSources<IngredientSections>

/**
 * CORRECTING THE PRICE — the one figure on this page the owner can be right
 * about and we can be wrong.
 *
 * `P.ingredient` has no button on it: the prototype's ingredient sheet is
 * "price history, the SKUs that match it, and everything it touches", a
 * reading surface end to end. This section is a deliberate addition to it, and
 * `e2e/fidelity/manifest.ts` carries the allowance that says so.
 *
 * The reason is in `costOf`, and it is the most expensive bug this codebase
 * has: `costPerRecipeUnit` is derived from vendor pack metadata, the parse
 * fails often enough to have its own guard, and when it fails it multiplies
 * $/unit by ten to two hundred. That number is what every recipe on the
 * account multiplies, so it lands in COGS and in the P&L — one week of this
 * account once read $193k because of it. `selectNonSpikeCostIndex` keeps the
 * spike out of the figures; nothing has ever fixed the stored value, and the
 * editorial ingredient sheet's form for doing it was dropped in the rebuild.
 * The person who knows what a case actually costs had no way to say so.
 *
 * The price and the unit are one control because they are one fact. Half of
 * all bad costs are a good number against the wrong unit — a case price stored
 * per ounce is the same disaster as a misread price — and a form that let the
 * owner fix one without seeing the other would keep producing the bug it
 * exists to remove.
 *
 * The lock is here rather than in an admin screen because the owner who has
 * just typed the right number is exactly the person who needs to stop the next
 * sync from putting the wrong one back.
 */
function CostForm({ cost }: { cost: IngredientCost }) {
  const router = useRouter()
  const [saving, startSaving] = useTransition()
  const [price, setPrice] = useState(cost.costNow === null ? "" : String(cost.costNow))
  const [unit, setUnit] = useState(cost.recipeUnit ?? "")
  const [locked, setLocked] = useState(cost.costLocked)
  const [error, setError] = useState<string | null>(null)

  const save = (nextLocked: boolean) => {
    setError(null)
    const trimmed = price.trim()
    const parsed = trimmed === "" ? null : Number(trimmed)
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setError("That is not a price.")
      return
    }
    startSaving(async () => {
      const result = await saveIngredientCost({
        ingredientId: cost.ingredientId,
        costPerRecipeUnit: parsed,
        recipeUnit: unit.trim() === "" ? null : unit.trim(),
        costLocked: nextLocked,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setLocked(nextLocked)
      // Every recipe using this ingredient re-costs off the value just
      // written, and the strip at the top of this page prints it.
      router.refresh()
    })
  }

  return (
    <div className="sec__body">
      <label className="search" style={{ display: "block", marginBottom: 7 }}>
        <input
          type="text"
          inputMode="decimal"
          value={price}
          placeholder="Price per recipe unit"
          aria-label="Price per recipe unit"
          onChange={(e) => setPrice(e.target.value)}
        />
      </label>
      <label className="search" style={{ display: "block" }}>
        <input
          type="text"
          value={unit}
          placeholder="Recipe unit — lb, oz, each"
          aria-label="Recipe unit"
          onChange={(e) => setUnit(e.target.value)}
        />
      </label>

      <div className="btnrow" style={{ marginTop: 11 }}>
        <button
          className="btn btn--primary"
          type="button"
          disabled={saving}
          onClick={() => save(locked)}
        >
          {saving ? "Saving…" : "Save this price"}
        </button>
        {/* Saves in the same call, so the owner never types a correction and
            then loses it to a sync because they forgot a second button. */}
        <button
          className="btn btn--quiet"
          type="button"
          disabled={saving}
          onClick={() => save(!locked)}
        >
          {locked ? "Unlock — let invoices set it" : "Save and lock against invoices"}
        </button>
      </div>

      <Note>{error ?? cost.note}</Note>
    </div>
  )
}


/**
 * `Last seen` sits beside `Last price`, because the two are one fact read
 * together: a price is only a price while it is still being quoted, and this
 * column is what says whether it is. See `skusOf` in the adapter for why a
 * list of part numbers without a date is half a list.
 */
const SKU_COLUMNS: Column[] = [
  { key: "vendor", label: "Vendor" },
  { key: "product", label: "Billed as" },
  { key: "pack", label: "Pack" },
  { key: "conversion", label: "Conversion" },
  { key: "price", label: "Last price", numeric: true },
  { key: "seen", label: "Last seen" },
  { key: "lines", label: "Lines", numeric: true },
]

/**
 * The arrivals table. Its fourth column names the ingredient's own recipe unit
 * — `In lb`, `In each` — because that is the unit the figures under it are
 * actually in, and a header reading "In recipe unit" would make the reader
 * look up which one that is on every row.
 *
 * `unit` is null when the ingredient has no recipe unit at all, and then
 * NOTHING in the column converts. The header says so rather than naming a unit
 * the page does not have; the adapter's note under the table says the rest.
 */
const deliveryColumns = (unit: string | null): Column[] => [
  { key: "date", label: "Date" },
  { key: "vendor", label: "Vendor" },
  // What the invoice said, in the invoice's own unit — usually cases.
  { key: "qty", label: "Billed", numeric: true },
  { key: "recipeQty", label: unit ? `In ${unit.toLowerCase()}` : "In recipe unit", numeric: true },
  { key: "value", label: "Value", numeric: true },
]

const USED_COLUMNS: Column[] = [
  { key: "recipe", label: "Recipe" },
  { key: "qty", label: "Qty", numeric: true },
  { key: "cost", label: "Line cost", numeric: true },
  { key: "sold", label: "Sold", numeric: true },
  { key: "move", label: "Cost of the move", numeric: true },
]

const ASK_SUGGESTIONS = [
  "How has this ingredient's price moved?",
  "When did this ingredient last arrive?",
  "Which recipes use this ingredient?",
  "Which vendors bill against it?",
]

export function CounterIngredientClient({
  params: paramsString,
  stores,
  today,
  title,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  title: string
  sections: CounterIngredientSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  // The breadcrumb names the RECORD. The title is a prop rather than a read
  // off `sections.head`, because reading a section here would mean awaiting
  // the loader — see `getIngredientName`.
  usePageChrome({ leaf: title, askSuggestions: ASK_SUGGESTIONS })

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
  const storeName = stores.find((s) => s.id === counterParams.storeId)?.name ?? "All stores"

  return (
    <>
      <PageHead title={title} sub={storeName}>
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
            {/* Recipe unit and category. These belong under the title and
                cannot go there: the masthead renders before the loader
                resolves. */}
            <Note lede>
              {h.sub}
            </Note>
            <Strip cells={h.cells} />
          </>
        )}
      </Section>

      <Section
        title="Price history"
        meta={(p) => p.meta}
        data={sections.prices}
        pending={pending}
        askAbout="how has this ingredient's price moved"
      >
        {(p) => (
          <>
            <Chart {...p.chart} fmt={PRICE} />
            <Note>
              {p.note}
            </Note>
          </>
        )}
      </Section>

      {/* The arrivals, under the prices. Both are read off the same invoice
          lines, and "when did it last turn up, and how much" is the question
          a reader asks straight after "what has it been costing". It sits
          ABOVE the SKU split rather than below it because the reader who has
          just seen a delivery is the one who then wants to know which code it
          was billed under — and because the split is where this page stops
          being one column. */}
      <Section
        title="Deliveries"
        meta={(x) => x.meta}
        data={sections.deliveries}
        pending={pending}
        pad={false}
        askAbout="when did this ingredient last arrive"
      >
        {(x) => (
          <>
            <Table columns={deliveryColumns(x.unit)} rows={x.rows} />
            {/* No `.sec__body` on a table section, so the note carries the
                body's own inset — same as the two tables below. */}
            <Note flush>
              {x.note}
            </Note>
          </>
        )}
      </Section>

      <div className="split">
        <Section
          title="Matched SKUs"
          meta={(s) => s.meta}
          data={sections.skus}
          pending={pending}
          pad={false}
        >
          {(s) => (
            <>
              <Table columns={SKU_COLUMNS} rows={s.rows} />
              {/* No `.sec__body` — a table section emits the table alone, so
                  the note carries the body's own inset via `<Note flush>`. */}
              <Note flush>
                {s.note}
              </Note>
            </>
          )}
        </Section>

        <Section
          title="Used in"
          meta={(u) => u.meta}
          data={sections.usedIn}
          pending={pending}
          pad={false}
          askAbout="which recipes use this ingredient"
        >
          {(u) => (
            <>
              <Table columns={USED_COLUMNS} rows={u.rows} />
              <Note flush>
                {u.note}
              </Note>
            </>
          )}
        </Section>
      </div>

      <Section
        title="What this costs"
        meta={(c) => c.meta}
        data={sections.cost}
        pending={pending}
        pad={false}
      >
        {(c) => <CostForm cost={c} />}
      </Section>
    </>
  )
}

/** Dollars, to the cent — a unit price, not a total. */
const PRICE = (v: number) => `$${v.toFixed(2)}`
