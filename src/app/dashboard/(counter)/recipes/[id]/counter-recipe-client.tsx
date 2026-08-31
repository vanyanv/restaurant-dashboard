"use client"

import { useCallback, useMemo, useState, useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  CostBar,
  DateControl,
  MoneyLines,
  PageHead,
  RowLine,
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
import type { BuilderLine, RecipeBuilder, RecipeSections } from "@/lib/counter/adapters/recipe"

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
 * button. The prototype also draws drag-to-reorder, a pantry search sheet, a
 * notes field and Duplicate. Reordering is not offered because
 * `RecipeIngredient` has no order column — the prototype's grip handle would
 * be a control that cannot persist what it appears to do, which is worse than
 * no handle. Adding a line uses a plain select over the pantry the adapter
 * already loaded rather than the prototype's search sheet: same decision, one
 * control, and it cannot offer a sub-recipe that would make a cycle because
 * the adapter filtered those out before they reached here.
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
          {(b) => <Builder builder={b} />}
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
            than a price. Its "Match it now" button is declared absent — see
            the manifest. */}
        <Section
          title="One line has no cost"
          meta={(c) => c.gap?.lead ?? "every line priced"}
          data={sections.cost}
          pending={pending}
        >
          {(c) =>
            c.gap ? (
              <p style={{ margin: 0, fontSize: "var(--ct-t-cap)", lineHeight: 1.5 }}>
                {c.gap.body}
              </p>
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

/**
 * The editable line list.
 *
 * Local state is seeded from the server's lines and is the only truth until
 * Save. A row edited and not saved must not be silently reconciled away by a
 * re-render, so nothing here re-syncs from props — `router.refresh()` after a
 * successful save is what brings the server's version back, and it remounts
 * this with fresh `builder.lines`.
 */
function Builder({ builder }: { builder: RecipeBuilder }) {
  const router = useRouter()
  const [lines, setLines] = useState<BuilderLine[]>(builder.lines)
  const [adding, setAdding] = useState("")
  const [note, setNote] = useState<string | null>(null)
  const [saving, start] = useTransition()

  const dirty =
    lines.length !== builder.lines.length ||
    lines.some((l, i) => {
      const was = builder.lines[i]
      return !was || was.key !== l.key || was.quantity !== l.quantity || was.unit !== l.unit
    })

  const options = [...builder.pantry, ...builder.components]

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

      {/* `P.recipe`'s `.addrow` — a control that ADDS a line, not a row of
          actions. It sat in a `.btnrow`, which is the class the design uses
          for the save/confirm/duplicate row underneath and nothing else, and
          the structure pass counted the second one as an extra. */}
      <div className="addrow-host" style={{ marginTop: 12 }}>
        <select
          className="inp"
          aria-label="Add an ingredient or a sub-recipe"
          value={adding}
          onChange={(e) => {
            const id = e.target.value
            const picked = options.find((o) => o.id === id)
            if (!picked) return
            setLines((prev) => [
              ...prev,
              {
                key: `new:${id}:${prev.length}`,
                kind: picked.kind as BuilderLine["kind"],
                refId: picked.id,
                name: picked.name,
                sub: picked.price,
                quantity: 1,
                unit: picked.unit,
                ext: "—",
                missing: picked.price === "no price" || picked.price === "no cost",
              },
            ])
            setAdding("")
          }}
        >
          <option value="">Add an ingredient or a sub-recipe…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} · {o.price}
            </option>
          ))}
        </select>
      </div>

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
        {builder.isConfirmed ? (
          <Tag tone="good">Confirmed</Tag>
        ) : (
          <button type="button" className="btn" disabled={saving} onClick={confirm}>
            Mark confirmed
          </button>
        )}
      </div>

      {note ? (
        <p className="mono" style={{ margin: "9px 0 0" }}>
          {note}
        </p>
      ) : null}
    </>
  )
}
