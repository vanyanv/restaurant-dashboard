"use client"

import { useCallback, useMemo, useState, useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  DateControl,
  Note,
  PageHead,
  Queue,
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
import { createRecipe } from "@/lib/counter/actions/recipe"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { RecipesSections } from "@/lib/counter/adapters/recipes"

/**
 * Recipes, composed from `P.recipes.desk()`
 * (`docs/counter/counter-prototype.html:6110`) in the prototype's own order:
 *
 *   strip → all recipes → a split of the worklist and component recipes.
 *
 * The adapter's docblock argues the departures, and there are four. Two of the
 * prototype's strip cells count populations of size zero on this account
 * (nothing is AI-generated, nothing is uncosted in its sense); the `Yield`
 * column is sixty ones; and the queue leads with one named plate rather than a
 * tally, because a sellable slider declaring a $0.00 food cost is worth more
 * than a count of unconfirmed recipes. This file renders what it is handed and
 * prints each reason under the section it belongs to.
 */
export type CounterRecipesSections = SectionSources<RecipesSections>

const CATALOGUE_COLUMNS: Column[] = [
  { key: "recipe", label: "Recipe" },
  { key: "category", label: "Category" },
  { key: "cost", label: "Cost / serving", numeric: true },
  { key: "price", label: "Sells at", numeric: true },
  { key: "margin", label: "Margin", numeric: true },
  { key: "state", label: "State" },
]

const COMPONENT_COLUMNS: Column[] = [
  { key: "component", label: "Component" },
  { key: "cost", label: "Cost", numeric: true },
  { key: "usedIn", label: "Used in", numeric: true },
  { key: "also", label: "Also" },
]

const ASK_SUGGESTIONS = [
  "Which plates have no recipe lines at all?",
  "How much revenue sits on unconfirmed recipes?",
  "Which recipes are used inside other recipes?",
]

export function CounterRecipesClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterRecipesSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  usePageChrome({ askSuggestions: ASK_SUGGESTIONS })

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
      <PageHead title="Recipes" sub={`${storeName} · what each plate is made of and what it costs`}>
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

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      <Section
        title="All recipes"
        meta={(c) => c.meta}
        data={sections.catalogue}
        pending={pending}
        pad={false}
        askAbout="which plates have no recipe lines at all"
      >
        {(c) => (
          <>
            <NewRecipe categories={c.categories} />
            <Table columns={CATALOGUE_COLUMNS} rows={c.rows} />
            {/* No `.sec__body` — a table section emits the table alone, so the
                note carries the body's own inset via `<Note flush>`. */}
            <Note flush>
              {c.note}
            </Note>
          </>
        )}
      </Section>

      <div className="split">
        <Section
          title="Needs confirming"
          meta={(w) => w.meta}
          data={sections.work}
          pending={pending}
          askAbout="how much revenue sits on unconfirmed recipes"
        >
          {(w) => <Queue items={w.items} />}
        </Section>

        <Section
          title="Component recipes"
          meta={(c) => c.meta}
          data={sections.components}
          pending={pending}
          pad={false}
        >
          {(c) => (
            <>
              <Table columns={COMPONENT_COLUMNS} rows={c.rows} />
              <Note flush>
                {c.note}
              </Note>
            </>
          )}
        </Section>
      </div>
    </>
  )
}

/**
 * Start a recipe — the create path this product has never had.
 *
 * `upsertRecipe` treats an omitted `id` as a create and always has; the only
 * caller that ever omitted one was the AI mapping-proposal accept. So an owner
 * who wanted a new dish in the book had to sell it first, wait for the
 * proposal job to notice the POS item, and accept whatever the model guessed.
 * Nothing on any screen made a recipe.
 *
 * A name and a category, then the editor. Everything else about a recipe — its
 * yield, its lines, its override — is built there, and a create form that
 * asked for all of it up front would be a second, worse copy of the page the
 * owner is about to land on.
 *
 * The category is a picker over the account's own vocabulary rather than a
 * text box, because "Burgers" and "burger" are two categories to every
 * grouping in the product and the catalogue above is where that first shows.
 */
function NewRecipe({ categories }: { categories: string[] }) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [category, setCategory] = useState(categories[0] ?? "Uncategorized")
  const [error, setError] = useState<string | null>(null)
  const [creating, start] = useTransition()

  const create = () => {
    setError(null)
    start(async () => {
      const result = await createRecipe({ itemName: name, category })
      if (result.ok && result.recipeId) {
        router.push(`/dashboard/recipes/${result.recipeId}`)
        return
      }
      setError(result.error ?? "Could not create that recipe.")
    })
  }

  return (
    <>
      <div className="newrec">
        <div className="inp">
          <input
            type="text"
            value={name}
            placeholder="Name a new recipe"
            aria-label="New recipe name"
            onChange={(e) => setName(e.target.value)}
            // Enter is what somebody types after a name in a one-field row.
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim() && !creating) create()
            }}
          />
        </div>
        <div className="inp inp--select">
          <select
            value={category}
            aria-label="New recipe category"
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.includes(category) ? null : (
              <option value={category}>{category}</option>
            )}
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          disabled={creating || name.trim() === ""}
          onClick={create}
        >
          {creating ? "Creating…" : "New recipe"}
        </button>
      </div>
      {error ? (
        <Note flush live tone="bad">
          {error}
        </Note>
      ) : null}
    </>
  )
}
