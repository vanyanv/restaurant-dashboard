"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  CostBar,
  DateControl,
  MoneyLines,
  Note,
  PageHead,
  RowLine,
  SearchGlyph,
  Section,
  Strip,
  Table,
  Tag,
  useCounterTransition,
  usePageChrome,
  type Column,
  type SwitchableStore,
} from "@/components/counter"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { stepRange } from "@/lib/counter/date-range"
import {
  costDraftRecipe,
  markRecipeConfirmed,
  removeRecipe,
  saveRecipeLines,
  type DraftCost,
} from "@/lib/counter/actions/recipe"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
  BuilderField,
  BuilderLine,
  PantryOption,
  RecipeBuilder,
  RecipeSections,
} from "@/lib/counter/adapters/recipe"

/**
 * The recipe builder, composed from `P.recipe.desk()`
 * (`docs/counter/counter-prototype.html:6154`):
 *
 *   strip → a split of the recipe, the cost panel and what it sells as →
 *   cost per serving over time.
 *
 * **This is the first Counter surface that writes.** The other 22 read. The
 * write path is `@/lib/counter/actions/recipe`, which stands to
 * `@/app/actions/recipe-actions` exactly as an adapter stands to a read
 * action — that module's docblock argues why, and the short version is that
 * `no-direct-data-import` forbids a page reaching `@/app/actions/*` and it is
 * right to.
 *
 * ## What is editable, and what is not
 *
 * Everything a recipe's cost depends on: the name, the category, the yield
 * and the unit it is measured in, the cost override, the notes, and every
 * line's quantity AND unit. Until this pass four of those six header fields
 * and the unit on every line were `<span>`s — the entire editable surface of
 * a recipe was a quantity box and a delete cross, which is why `servingSize`
 * reads 1 on all sixty rows in this account. `upsertRecipe` has always
 * accepted all of it; only the input was missing.
 *
 * Reordering is still not offered because `RecipeIngredient` has no order
 * column — the prototype's grip handle would be a control that cannot persist
 * what it appears to do, which is worse than no handle.
 *
 * ## The unit box is a picker, not a text field
 *
 * Its options are only ever units that convert into what the ingredient is
 * PRICED in, or into the sub-recipe's own batch unit. A line reading `2 cup`
 * against a price per `lb` costs $0.00 on every recosting for the life of the
 * recipe and still reports the plate as costed; making that line unreachable
 * from the control is better than refusing it at save, and `validateRecipeShape`
 * refuses it at save anyway for everything that does not come through here.
 *
 * ## The cost panel moves while you type
 *
 * `costDraftRecipe` re-walks the draft server-side, debounced. The panel used
 * to be rendered from the SAVED recipe and nothing recomputed it, so changing
 * a quantity from 2 to 4 showed the old figure until you saved and the page
 * refreshed: the one question this screen exists to answer could only be
 * answered by committing the change first.
 *
 * ## The pantry sheet, and why the line state lives up here
 *
 * `P.recipe` draws "Add an ingredient" as its own panel beside the builder —
 * a search box over the pantry, and a row per match tagged with what it is to
 * THIS recipe. It is a second `.sec` rather than a control inside the first,
 * which is what forced the shape of this file: two sibling sections cannot
 * each own the draft, the picker has to know which ingredients are already
 * lines to tag them, and the cost panel is a third sibling that now has to
 * read the draft too.
 *
 * So the draft lives here, keyed on the SERVER's line array by identity. That
 * key is not decoration: a refreshed loader hands down a new `builder.lines`,
 * the key stops matching, and a draft belonging to a version of the recipe
 * that no longer exists cannot be mistaken for one that does. A successful
 * save ALSO drops the draft by hand (`clearDraft`), because the key governs
 * what is rendered and not what the live-cost effect is watching — without
 * it the cost panel goes on reporting "unsaved" over a figure the save has
 * already superseded. Nothing re-syncs mid-edit: a row edited and not saved
 * is still the only truth until Save.
 */
export type CounterRecipeSections = SectionSources<RecipeSections>

const ASK_SUGGESTIONS = [
  "What is this plate's food cost?",
  "Which ingredient moved this recipe's cost most?",
  "What else uses these ingredients?",
]

/** The prototype's own builder grid: name, qty, unit, extended, remove. */
const LINE_COLUMNS = "minmax(0,1fr) 72px 92px 84px 32px"

/** How long the editor sits still before it asks the server to re-cost. */
const COST_DEBOUNCE_MS = 400

/** Header values, as the controls hold them: strings, exactly as typed. */
type FieldValues = Record<BuilderField["key"], string>

type Draft = {
  /** The loader's own line array, by identity. See the docblock. */
  base: BuilderLine[]
  lines: BuilderLine[]
  fields: FieldValues
}

const fieldsOf = (b: RecipeBuilder): FieldValues =>
  b.fields.reduce((acc, f) => {
    acc[f.key] = f.value
    return acc
  }, {} as FieldValues)

/** "" means the owner cleared it, which is a real value — null, not unset. */
const moneyOrNull = (raw: string): number | null => {
  const t = raw.trim()
  if (t === "") return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

/**
 * The yield as typed, for the SAVE.
 *
 * `NaN` is deliberate on an empty or nonsense box: `validateRecipeShape`
 * refuses it and the owner reads "a recipe has to make at least some of
 * something". Substituting 1 here would take a cleared field and write a
 * yield — and on a recipe that makes 128 fl oz, quietly multiplying its
 * per-serving cost by a hundred and twenty-eight.
 */
const yieldTyped = (raw: string): number => Number(raw.trim() === "" ? NaN : raw)

/**
 * The yield for the LIVE PREVIEW, which is a different question.
 *
 * A draft mid-keystroke is legitimately half-typed, and a preview that
 * vanishes every time the box is empty for a moment is worse than one that
 * falls back to a single serving for that moment. Nothing is written from it.
 */
const yieldOrOne = (raw: string): number => {
  const v = yieldTyped(raw)
  return Number.isFinite(v) && v > 0 ? v : 1
}

export function CounterRecipeClient({
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
  sections: CounterRecipeSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  // The breadcrumb names the RECORD — "Recipes / Double Slider" — which is
  // `Topbar`'s documented contract for a detail route. Without a leaf it falls
  // back to the nav destination's label and reads "Recipes / Recipes". The
  // title arrives as a prop rather than out of `sections.head`, because
  // reading a section here would mean awaiting the loader — see
  // `getRecipeName`.
  usePageChrome({ leaf: title, askSuggestions: ASK_SUGGESTIONS })

  const { pending, startTransition } = useCounterTransition()

  /*
   * The draft, keyed on the server's own line array by identity. See the
   * docblock: `base` is what the loader last handed down, so a `router.refresh()`
   * after a save replaces it and the draft falls away on its own rather than
   * being cleared by hand from three places.
   */
  const [draft, setDraft] = useState<Draft | null>(null)
  const draftOf = useCallback(
    (b: RecipeBuilder): Draft =>
      draft && draft.base === b.lines
        ? draft
        : { base: b.lines, lines: b.lines, fields: fieldsOf(b) },
    [draft],
  )
  const editLines = useCallback(
    (b: RecipeBuilder, fn: (prev: BuilderLine[]) => BuilderLine[]) =>
      setDraft((d) => {
        const from = d && d.base === b.lines ? d : { base: b.lines, lines: b.lines, fields: fieldsOf(b) }
        return { ...from, base: b.lines, lines: fn(from.lines) }
      }),
    [],
  )
  /*
   * Drop the draft outright.
   *
   * The identity key alone is not enough after a SAVE. `router.refresh()`
   * hands down a new `builder.lines`, so `draftOf` stops returning the draft
   * — but the `draft` STATE still holds the old object, the live-cost effect
   * still sees it, and the cost panel goes on reporting "unsaved" over a
   * figure that was superseded, with each row's extended cost read out of a
   * preview taken before the save. So the save says so explicitly.
   */
  const clearDraft = useCallback(() => setDraft(null), [])

  const editField = useCallback(
    (b: RecipeBuilder, key: BuilderField["key"], value: string) =>
      setDraft((d) => {
        const from = d && d.base === b.lines ? d : { base: b.lines, lines: b.lines, fields: fieldsOf(b) }
        return { ...from, base: b.lines, fields: { ...from.fields, [key]: value } }
      }),
    [],
  )

  /*
   * The live cost of whatever is on screen. Null means nothing is in draft and
   * the server's own figures — which are the saved recipe's — stand.
   *
   * Debounced rather than fired per keystroke: this is a full recipe walk on
   * the server, including every sub-recipe underneath, and a walk per
   * character typed into a quantity box would be one request per character.
   */
  const [live, setLive] = useState<DraftCost | null>(null)
  useEffect(() => {
    if (!draft) {
      setLive(null)
      return
    }
    let alive = true
    const timer = setTimeout(() => {
      void costDraftRecipe({
        servingSize: yieldOrOne(draft.fields.servingSize ?? "1"),
        yieldUnit: (draft.fields.yieldUnit ?? "").trim() || null,
        foodCostOverride: moneyOrNull(draft.fields.foodCostOverride ?? ""),
        lines: draft.lines.map((l) => ({
          canonicalIngredientId: l.kind === "ingredient" ? l.refId : null,
          componentRecipeId: l.kind === "component" ? l.refId : null,
          quantity: l.quantity,
          unit: l.unit,
        })),
      }).then(
        (result) => {
          if (alive) setLive(result)
        },
        // A transport failure is not a cost of zero and not the previous
        // cost either. Dropping back to the server's own figure is the only
        // honest answer, and an unhandled rejection would leave the stale one
        // on screen wearing the word "unsaved".
        () => {
          if (alive) setLive(null)
        },
      )
    }, COST_DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [draft])

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
      {/* The sentence under the title — category, yield, confirmation — is in
          the strip's own section below, because it comes from the loader and
          the masthead must not wait on it. */}
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
            {/* Category, yield and confirmation state. These belong under the
                title and cannot go there: the masthead renders before the
                loader resolves, and a sentence that appears a beat late reads
                as a layout shift rather than as information. */}
            <Note lede>
              {h.sub}
            </Note>
            <Strip cells={h.cells} />
          </>
        )}
      </Section>

      <div className="split">
        <Section
          title="The recipe"
          meta={(b) => b.meta}
          data={sections.builder}
          pending={pending}
          askAbout="what is this plate's food cost"
        >
          {(b) => (
            <Builder
              builder={b}
              draft={draftOf(b)}
              live={live}
              onLines={(fn) => editLines(b, fn)}
              onField={(key, value) => editField(b, key, value)}
              onSaved={clearDraft}
            />
          )}
        </Section>

        {/* `P.recipe`'s pantry sheet. `pad={false}` because the prototype
            builds this one with `raw()` — a `.sec` and a `.sec__head` with the
            sheet directly under them and no `.sec__body`, since the sheet
            draws its own border and a body's padding would double it. */}
        <Section
          title="Add an ingredient"
          meta={() => "search the pantry"}
          data={sections.builder}
          pending={pending}
          pad={false}
        >
          {(b) => (
            <Picker
              builder={b}
              lines={draftOf(b).lines}
              onAdd={(o) =>
                editLines(b, (prev) => [...prev, lineFromOption(o, prev.length)])
              }
            />
          )}
        </Section>

        <Section
          title="What it costs"
          meta={() => (live ? "unsaved" : "live")}
          data={sections.cost}
          pending={pending}
        >
          {(c) => (
            <>
              <span className="k">Cost per serving</span>
              <div className="big" style={{ margin: "2px 0 10px" }}>
                {/* The draft's figure when there is a draft, because a panel
                    showing the SAVED cost next to an edited line is the one
                    thing this screen must never do: it answers the question
                    the owner is asking with the answer to the old one. */}
                {live ? COST(live.perServing) : c.perServing}
              </div>
              {/* Where that figure came from, when it was divided. A batch
                  recipe's per-serving cost is `batch ÷ yield`, and without
                  this line the two numbers on this page look unrelated. */}
              {live ? (
                <Note bare>
                  Unsaved. Batch {COST(live.batch)}
                  {live.partial ? " so far — at least one line has no cost." : "."}
                </Note>
              ) : c.batch ? (
                <Note bare>{c.batch}</Note>
              ) : null}
              {/* CostBar draws its own legend — this rendered it twice. */}
              <CostBar bands={c.bands} />
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 11,
                  borderTop: "1px solid var(--line-strong)",
                }}
              >
                <MoneyLines rows={c.money} />
              </div>
              <Note>
                {c.foot}
              </Note>
              <Note>
                {c.note}
              </Note>
            </>
          )}
        </Section>

        {/* `P.recipe`'s "One line has no cost", which was a red paragraph at
            the foot of "What it costs". The design gives it a panel, and it
            deserves one: it is the reason the figure above is a floor rather
            than a price.

            `P.recipe` puts "Match it now" here. The button is real and the
            WORDS are not the design's, because nothing in this product
            matches a SKU to an ingredient by hand — the matcher is a nightly
            ladder and the ingredient page is a read-only audit of what it
            decided. So the button goes where the answer is and says that
            instead of promising a fix it cannot perform. It appears only on
            the branch that has an ingredient to point at; a recipe with no
            lines at all gets the sentence and no button. */}
        <Section
          title="One line has no cost"
          meta={(c) => c.gap?.lead ?? "every line priced"}
          data={sections.cost}
          pending={pending}
        >
          {(c) =>
            c.gap ? (
              <>
                <p
                  style={{
                    margin: c.gap.href ? "0 0 10px" : 0,
                    fontSize: "var(--ct-t-cap)",
                    lineHeight: 1.5,
                  }}
                >
                  {c.gap.body}
                </p>
                {c.gap.href ? (
                  <Link
                    className="btn"
                    href={c.gap.href}
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    See what it is matched to
                  </Link>
                ) : null}
              </>
            ) : (
              <p style={{ margin: 0, fontSize: "var(--ct-t-cap)", lineHeight: 1.5 }}>
                Every line on this recipe has a cost, so the plate cost above is exact rather
                than a floor.
              </p>
            )
          }
        </Section>

        {/* `.linkpop` chips, which is what `P.recipe` draws here — see
            `RecipeSellsAs` for why this stopped being a table. */}
        <Section title="Sells as" meta={(s) => s.meta} data={sections.sellsAs} pending={pending}>
          {(s) => (
            <>
              {s.links.map((l, i) => (
                <div className="linkpop" key={l.key} style={i > 0 ? { marginTop: 7 } : undefined}>
                  {l.name}
                  <Tag tone={l.kind === "item" ? "good" : "warn"}>
                    {l.kind === "item" ? "Menu item" : "Modifier"}
                  </Tag>
                </div>
              ))}
              <Note>
                {s.note}
              </Note>
            </>
          )}
        </Section>
      </div>

      <Section
        title="Cost per serving"
        meta={(t) => t.meta}
        data={sections.trend}
        pending={pending}
      >
        {(t) => (
          <>
            <Chart {...t.chart} fmt={COST} />
            <Note>
              {t.note}
            </Note>
          </>
        )}
      </Section>
    </>
  )
}

const COST = (v: number) => `$${v.toFixed(2)}`

/** How many pantry rows the sheet draws at once. `P.recipe` shows three. */
const PICK_ROWS = 8

/** A pantry option turned into a draft line, before anything is saved. */
function lineFromOption(o: PantryOption, at: number): BuilderLine {
  return {
    key: `new:${o.id}:${at}`,
    kind: o.kind,
    refId: o.id,
    name: o.name,
    sub: o.price,
    quantity: 1,
    unit: o.unit,
    // The option carries the units that can measure it — a line added from
    // the picker starts with the same choices an existing line has, so it
    // cannot be the one row on the plate whose unit is unfixable.
    unitOptions: o.unitOptions,
    // Never a figure until it has been costed. A number here would be this
    // page inventing the extended cost of a quantity nobody has typed yet;
    // the live walk fills it in a beat later.
    ext: "—",
    missing: o.price === "no price" || o.price === "no cost",
    missingWhy: o.price === "no price" || o.price === "no cost" ? "no price" : null,
    priceAgeDays: null,
  }
}

/**
 * `P.recipe`'s pantry sheet — search the pantry, add a line.
 *
 * The third column is what each match is TO THIS RECIPE, which is the whole
 * reason this panel needs the draft rather than just the catalogue: an
 * ingredient already on the plate is the one thing a picker must not let you
 * add twice without saying so.
 *
 * The design's middle row reads "Alternative SKU" — a different vendor's
 * product for the same ingredient. That relation is not in this data: a
 * canonical ingredient IS the thing SKUs match onto, so there is no second
 * canonical to call an alternative. The tag says what is true instead —
 * whether the option is a sub-recipe, and whether it carries a price at all.
 *
 * A `<button>` per row rather than the prototype's `<div cursor:pointer>`. A
 * row that adds a line is a control, and a div is not one to anybody who is
 * not holding a mouse.
 */
function Picker({
  builder,
  lines,
  onAdd,
}: {
  builder: RecipeBuilder
  lines: BuilderLine[]
  onAdd: (option: PantryOption) => void
}) {
  const [query, setQuery] = useState("")

  const all = useMemo(
    () => [...builder.pantry, ...builder.components],
    [builder.pantry, builder.components],
  )
  const onPlate = useMemo(() => new Set(lines.map((l) => l.refId)), [lines])

  const q = query.trim().toLowerCase()
  // Unsearched, the sheet shows the head of the pantry rather than all four
  // hundred: a panel that is a page-long list before you have typed is not a
  // picker. The count in the head says what is behind it.
  const matched = q ? all.filter((o) => o.name.toLowerCase().includes(q)) : all
  const shown = matched.slice(0, PICK_ROWS)

  return (
    <div className="pickersheet">
      <div className="hd">
        <SearchGlyph />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the pantry"
          aria-label="Search the pantry"
        />
        {/* What is BEHIND the sheet, which is what the comment above promises.
            `shown` is `matched` sliced to PICK_ROWS, so a search matching
            thirty of four hundred read "8 of 400" — the cap, reported as the
            match. Same form `/dashboard/invoices` uses. */}
        <span className="mono" style={{ marginLeft: "auto" }}>
          {shown.length === matched.length
            ? `${matched.length} of ${all.length}`
            : `${shown.length} of ${matched.length} shown`}
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="pickrow">
          <span>Nothing in the pantry matches “{query}”.</span>
          <span />
          <Tag>No match</Tag>
        </div>
      ) : null}

      {shown.map((o) => {
        const here = onPlate.has(o.id)
        return (
          <button
            type="button"
            className="pickrow"
            key={`${o.kind}:${o.id}`}
            onClick={() => onAdd(o)}
          >
            <span>{o.name}</span>
            <span>{o.price}</span>
            {here ? (
              <Tag tone="good">In this recipe</Tag>
            ) : o.price === "no price" || o.price === "no cost" ? (
              <Tag tone="bad">Uncosted</Tag>
            ) : o.kind === "component" ? (
              <Tag tone="warn">Sub-recipe</Tag>
            ) : (
              <Tag>In the pantry</Tag>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * One header field as a control.
 *
 * `money` is a number input with a step of a cent rather than a text box,
 * because an override typed as "4.50" and stored as a string is the kind of
 * thing that reaches a P&L as `NaN`. `select` carries the current value's own
 * option even when the adapter did not list it — an existing recipe in a
 * category nobody else uses must not silently change category by being
 * rendered.
 */
function Field({
  field,
  value,
  onChange,
  wide,
}: {
  field: BuilderField
  value: string
  onChange: (next: string) => void
  wide?: boolean
}) {
  const label = (
    <label htmlFor={`rf-${field.key}`}>{field.label}</label>
  )

  if (field.kind === "select") {
    const options = field.options ?? []
    const known = options.some((o) => o.value === value)
    return (
      <div className={wide ? "field2 field2--wide" : "field2"}>
        {label}
        <div className="inp inp--select">
          <select
            id={`rf-${field.key}`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            {known ? null : <option value={value}>{value || "—"}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {field.hint ? <span className="hint">{field.hint}</span> : null}
      </div>
    )
  }

  if (field.kind === "textarea") {
    return (
      <div className={wide ? "field2 field2--wide" : "field2"}>
        {label}
        <div className="inp">
          <textarea
            id={`rf-${field.key}`}
            rows={2}
            value={value}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
        {field.hint ? <span className="hint">{field.hint}</span> : null}
      </div>
    )
  }

  const numeric = field.kind === "number" || field.kind === "money"
  return (
    <div className={wide ? "field2 field2--wide" : "field2"}>
      {label}
      <div className="inp">
        <input
          id={`rf-${field.key}`}
          type={numeric ? "number" : "text"}
          inputMode={numeric ? "decimal" : undefined}
          step={field.kind === "money" ? "0.01" : "any"}
          min={numeric ? "0" : undefined}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {field.hint ? <span className="hint">{field.hint}</span> : null}
    </div>
  )
}

/**
 * The editable line list and the recipe's own header.
 *
 * The draft is the only truth until Save. A row edited and not saved must not
 * be silently reconciled away by a re-render, so nothing here re-syncs from
 * props — `router.refresh()` after a successful save is what brings the
 * server's version back, and it hands down a new `builder.lines` that the
 * draft's identity key no longer matches.
 */
function Builder({
  builder,
  draft,
  live,
  onLines,
  onField,
  onSaved,
}: {
  builder: RecipeBuilder
  draft: Draft
  live: DraftCost | null
  onLines: (fn: (prev: BuilderLine[]) => BuilderLine[]) => void
  onField: (key: BuilderField["key"], value: string) => void
  /** Drop the draft — what was on screen is now what is stored. */
  onSaved: () => void
}) {
  const router = useRouter()
  const setLines = onLines
  const lines = draft.lines
  // The outcome travels with the text — see the same note in Settings.
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, start] = useTransition()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const saved = useMemo(() => fieldsOf(builder), [builder])
  const fieldsDirty = (Object.keys(saved) as Array<BuilderField["key"]>).some(
    (k) => (draft.fields[k] ?? "") !== (saved[k] ?? ""),
  )
  const linesDirty =
    lines.length !== builder.lines.length ||
    lines.some((l, i) => {
      const was = builder.lines[i]
      return !was || was.key !== l.key || was.quantity !== l.quantity || was.unit !== l.unit
    })
  const dirty = fieldsDirty || linesDirty

  const save = () => {
    setNote(null)
    start(async () => {
      const result = await saveRecipeLines({
        recipeId: builder.recipeId,
        itemName: draft.fields.itemName?.trim() || undefined,
        category: draft.fields.category?.trim() || undefined,
        servingSize: yieldTyped(draft.fields.servingSize ?? ""),
        // "" is portions, which is a value and not an omission — hence the
        // `?? ""` rather than a truthiness test that would send `undefined`
        // and leave a measured batch measured.
        yieldUnit: (draft.fields.yieldUnit ?? "").trim() || null,
        notes: (draft.fields.notes ?? "").trim() || null,
        foodCostOverride: moneyOrNull(draft.fields.foodCostOverride ?? ""),
        lines: lines.map((l) => ({
          canonicalIngredientId: l.kind === "ingredient" ? l.refId : null,
          componentRecipeId: l.kind === "component" ? l.refId : null,
          quantity: l.quantity,
          unit: l.unit,
        })),
      })
      setNote({ ok: result.ok, text: result.ok ? "Saved." : result.error ?? "Could not save." })
      if (result.ok) {
        onSaved()
        router.refresh()
      }
    })
  }

  const confirm = () => {
    setNote(null)
    start(async () => {
      const result = await markRecipeConfirmed(builder.recipeId)
      setNote({ ok: result.ok, text: result.ok ? "Confirmed." : result.error ?? "Could not confirm." })
      if (result.ok) {
        // The refresh replaces the rows with the server's, so the draft has
        // to go with them. Without this the rows reverted while the cost
        // panel went on showing the discarded draft's figures under the word
        // "unsaved" — the same defect `clearDraft` exists for, wired into
        // only one of the two controls that refresh.
        onSaved()
        router.refresh()
      }
    })
  }

  const remove = () => {
    setNote(null)
    start(async () => {
      const result = await removeRecipe(builder.recipeId)
      if (result.ok) {
        router.push("/dashboard/recipes")
        return
      }
      setConfirmingDelete(false)
      setNote({ ok: false, text: result.error ?? "Could not delete this recipe." })
    })
  }

  /* The header, in the prototype's own order. `servingSize` and `yieldUnit`
     are drawn as one cell because they are one sentence — "one batch makes
     24 portions" split across two grid cells that can land on different rows
     reads as two unrelated numbers, and the difference between 24 portions
     and 24 fluid ounces is the difference between a sub-recipe line costing
     cents and costing sixty dollars. */
  const byKey = new Map(builder.fields.map((f) => [f.key, f]))
  const yieldField = byKey.get("servingSize")
  const yieldUnitField = byKey.get("yieldUnit")

  return (
    <>
      <div className="rfields" style={{ marginBottom: 14 }}>
        {builder.fields.map((f) => {
          if (f.key === "yieldUnit") return null
          if (f.key === "servingSize" && yieldField && yieldUnitField) {
            return (
              <div className="field2--pair" key="yield">
                <Field
                  field={yieldField}
                  value={draft.fields.servingSize ?? ""}
                  onChange={(v) => onField("servingSize", v)}
                />
                <Field
                  field={yieldUnitField}
                  value={draft.fields.yieldUnit ?? ""}
                  onChange={(v) => onField("yieldUnit", v)}
                />
              </div>
            )
          }
          return (
            <Field
              key={f.key}
              field={f}
              value={draft.fields[f.key] ?? ""}
              onChange={(v) => onField(f.key, v)}
              wide={f.key === "itemName" || f.key === "notes"}
            />
          )
        })}
      </div>

      {lines.length === 0 ? (
        <Note lede>
          No lines. Nothing about this plate has been costed — add one below and its cost stops
          being whatever the override says.
        </Note>
      ) : null}

      {lines.map((l, i) => {
        // The live walk answers in the order it was sent, so a line's own
        // figure is the one at its index — but only while the two agree on
        // length, which they do not for the beat between adding a row and the
        // debounce firing.
        const fresh = live && live.lines.length === lines.length ? live.lines[i] : null
        const ext = fresh ? (fresh.ext === null ? "—" : COST(fresh.ext)) : l.ext
        const missing = fresh ? fresh.missing : l.missing
        const stale = l.priceAgeDays !== null && l.priceAgeDays > STALE_ON_SCREEN_DAYS
        return (
          <RowLine
            key={l.key}
            columns={LINE_COLUMNS}
            name={l.name}
            sub={l.sub}
          >
            <input
              className="inp"
              type="number"
              step="0.01"
              min="0"
              aria-label={`${l.name} quantity`}
              value={l.quantity}
              onChange={(e) => {
                const v = Number(e.target.value)
                setLines((prev) =>
                  prev.map((p, j) => (j === i ? { ...p, quantity: Number.isFinite(v) ? v : 0 } : p)),
                )
              }}
            />
            {/* A control, where this was a `<span>`. Its options are only ever
                units that convert into what the thing is priced or made in, so
                the $0.00 line is unreachable rather than merely discouraged. */}
            <select
              className="unit"
              aria-label={`${l.name} unit`}
              value={l.unit}
              onChange={(e) => {
                const unit = e.target.value
                setLines((prev) => prev.map((p, j) => (j === i ? { ...p, unit } : p)))
              }}
            >
              {l.unitOptions.includes(l.unit) ? null : (
                <option value={l.unit}>{l.unit}</option>
              )}
              {l.unitOptions.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <span className="ext">
              {ext}
              {/* Two different problems with two different fixes, where the
                  row used to print the same sentence for both: a line with no
                  price needs an invoice, and a line whose unit cannot convert
                  needs the box to its left changed. */}
              {missing && l.missingWhy ? <span className="why">{l.missingWhy}</span> : null}
              {!missing && stale ? (
                <span className="why stale">price is {l.priceAgeDays} days old</span>
              ) : null}
            </span>
            <button
              type="button"
              className="del"
              aria-label={`Remove ${l.name}`}
              onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </RowLine>
        )
      })}

      <div className="btnrow" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn--primary"
          disabled={saving || !dirty}
          onClick={save}
        >
          {saving ? "Saving…" : dirty ? "Save recipe" : "Saved"}
        </button>
        {/* A BUTTON in both states, where this used to swap to a `<Tag>`.
            The design draws a control here and the control is what says
            whether the recipe has been checked; a tag says the same thing and
            leaves a hole where the reader expects to act. Confirming twice is
            not a thing to offer, so the confirmed state is the button,
            disabled, wearing the word. */}
        <button
          type="button"
          className="btn"
          disabled={saving || builder.isConfirmed}
          onClick={confirm}
        >
          {builder.isConfirmed ? "Confirmed" : "Mark confirmed"}
        </button>
        {/* Delete, which the product has never offered from this page even
            though `deleteRecipe` has always existed. It is disabled rather
            than hidden when something uses this recipe as a sub-recipe,
            because "why can I not remove this" is a question the page should
            answer rather than leave to a missing button. */}
        <button
          type="button"
          className="btn btn--quiet"
          disabled={saving || builder.deleteBlockedBy !== null}
          title={builder.deleteBlockedBy ?? undefined}
          onClick={() => (confirmingDelete ? remove() : setConfirmingDelete(true))}
        >
          {confirmingDelete ? "Really delete" : "Delete"}
        </button>
      </div>

      {builder.deleteBlockedBy ? (
        <Note>
          This recipe cannot be deleted: {builder.deleteBlockedBy} Remove it from that recipe
          first.
        </Note>
      ) : null}

      {note ? (
        <Note live tone={note.ok ? "good" : "bad"}>
          {note.text}
        </Note>
      ) : null}
    </>
  )
}

/**
 * Past this, a line says how old its price is.
 *
 * The adapter already writes the age into the line's sub-line for every line;
 * this is the point at which it stops being provenance and starts being a
 * warning, and it matches `STALE_PRICE_DAYS` in the adapter.
 */
const STALE_ON_SCREEN_DAYS = 45
