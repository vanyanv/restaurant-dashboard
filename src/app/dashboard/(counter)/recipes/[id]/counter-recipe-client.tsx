"use client"

import { useCallback, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  CostBar,
  DateControl,
  MoneyLines,
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
import { markRecipeConfirmed, saveRecipeLines } from "@/lib/counter/actions/recipe"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
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
 * Quantities and removal are editable inline, and both save through one
 * button. Reordering is not offered because `RecipeIngredient` has no order
 * column — the prototype's grip handle would be a control that cannot persist
 * what it appears to do, which is worse than no handle.
 *
 * ## The pantry sheet, and why the line state moved up here
 *
 * `P.recipe` draws "Add an ingredient" as its own panel beside the builder —
 * a search box over the pantry, and a row per match tagged with what it is to
 * THIS recipe. It is built now, and it is a second `.sec` rather than a
 * control inside the first, which is what forced the change of shape in this
 * file: two sibling sections cannot each own the draft, and the picker has to
 * know which ingredients are already lines to tag them.
 *
 * So the draft lives here, keyed on the SERVER's line array by identity. That
 * key is not decoration. It is what makes `router.refresh()` after a save
 * behave the way the old local state did: a refreshed loader hands down a new
 * `builder.lines`, the key stops matching, and the draft is dropped in favour
 * of what was actually written. Nothing re-syncs mid-edit — a row edited and
 * not saved is still the only truth until Save.
 */
export type CounterRecipeSections = SectionSources<RecipeSections>

const ASK_SUGGESTIONS = [
  "What is this plate's food cost?",
  "Which ingredient moved this recipe's cost most?",
  "What else uses these ingredients?",
]

/** The prototype's own builder grid: name, qty, unit, extended, remove. */
const LINE_COLUMNS = "minmax(0,1fr) 72px 64px 84px 32px"

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
  const [draft, setDraft] = useState<{ base: BuilderLine[]; lines: BuilderLine[] } | null>(null)
  const linesOf = useCallback(
    (b: RecipeBuilder) => (draft && draft.base === b.lines ? draft.lines : b.lines),
    [draft],
  )
  const editLines = useCallback(
    (b: RecipeBuilder, fn: (prev: BuilderLine[]) => BuilderLine[]) =>
      setDraft((d) => ({
        base: b.lines,
        lines: fn(d && d.base === b.lines ? d.lines : b.lines),
      })),
    [],
  )

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
            <p className="mono" style={{ margin: "0 0 11px" }}>
              {h.sub}
            </p>
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
            <Builder builder={b} lines={linesOf(b)} onLines={(fn) => editLines(b, fn)} />
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
              lines={linesOf(b)}
              onAdd={(o) =>
                editLines(b, (prev) => [...prev, lineFromOption(o, prev.length)])
              }
            />
          )}
        </Section>

        <Section title="What it costs" meta={() => "live"} data={sections.cost} pending={pending}>
          {(c) => (
            <>
              <span className="k">Cost per serving</span>
              <div className="big" style={{ margin: "2px 0 10px" }}>
                {c.perServing}
              </div>
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
              <p className="mono" style={{ margin: "9px 0 0" }}>
                {c.foot}
              </p>
              <p className="mono" style={{ margin: "11px 0 0" }}>
                {c.note}
              </p>
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
              <p className="mono" style={{ margin: "9px 0 0" }}>
                {s.note}
              </p>
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
            <p className="mono" style={{ margin: "9px 0 0" }}>
              {t.note}
            </p>
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
    // Never a figure until it has been saved and re-costed. A number here
    // would be this page inventing the extended cost of a quantity nobody has
    // typed yet.
    ext: "—",
    missing: o.price === "no price" || o.price === "no cost",
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
  const shown = (q ? all.filter((o) => o.name.toLowerCase().includes(q)) : all).slice(0, PICK_ROWS)

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
        <span className="mono" style={{ marginLeft: "auto" }}>
          {shown.length} of {all.length}
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
 * The editable line list.
 *
 * Local state is seeded from the server's lines and is the only truth until
 * Save. A row edited and not saved must not be silently reconciled away by a
 * re-render, so nothing here re-syncs from props — `router.refresh()` after a
 * successful save is what brings the server's version back, and it remounts
 * this with fresh `builder.lines`.
 */
function Builder({
  builder,
  lines,
  onLines,
}: {
  builder: RecipeBuilder
  lines: BuilderLine[]
  onLines: (fn: (prev: BuilderLine[]) => BuilderLine[]) => void
}) {
  const router = useRouter()
  const setLines = onLines
  const [note, setNote] = useState<string | null>(null)
  const [saving, start] = useTransition()

  const dirty =
    lines.length !== builder.lines.length ||
    lines.some((l, i) => {
      const was = builder.lines[i]
      return !was || was.key !== l.key || was.quantity !== l.quantity || was.unit !== l.unit
    })

  const save = () => {
    setNote(null)
    start(async () => {
      const result = await saveRecipeLines({
        recipeId: builder.recipeId,
        lines: lines.map((l) => ({
          canonicalIngredientId: l.kind === "ingredient" ? l.refId : null,
          componentRecipeId: l.kind === "component" ? l.refId : null,
          quantity: l.quantity,
          unit: l.unit,
        })),
      })
      setNote(result.ok ? "Saved." : result.error)
      if (result.ok) router.refresh()
    })
  }

  const confirm = () => {
    setNote(null)
    start(async () => {
      const result = await markRecipeConfirmed(builder.recipeId)
      setNote(result.ok ? "Confirmed." : result.error)
      if (result.ok) router.refresh()
    })
  }

  return (
    <>
      <div className="rfields" style={{ marginBottom: 14 }}>
        {builder.fields.map((f) => (
          <div className="field2" key={f.key}>
            <label>{f.label}</label>
            <div className="inp">
              <span className={f.placeholder ? "val ph" : "val"}>{f.value}</span>
            </div>
          </div>
        ))}
      </div>

      {lines.length === 0 ? (
        <p className="mono" style={{ margin: "0 0 12px" }}>
          No lines. Nothing about this plate has been costed — add one below and its cost stops
          being whatever the override says.
        </p>
      ) : null}

      {lines.map((l, i) => (
        <RowLine
          key={l.key}
          columns={LINE_COLUMNS}
          name={l.name}
          sub={l.missing ? `${l.sub} — this line has no cost` : l.sub}
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
          <span className="unit">{l.unit}</span>
          <span className="ext">{l.ext}</span>
          <button
            type="button"
            className="del"
            aria-label={`Remove ${l.name}`}
            onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </RowLine>
      ))}

      {builder.notes ? (
        <p className="mono" style={{ margin: "12px 0 0" }}>
          {builder.notes}
        </p>
      ) : null}

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
      </div>

      {note ? (
        <p className="mono" style={{ margin: "9px 0 0" }}>
          {note}
        </p>
      ) : null}
    </>
  )
}
