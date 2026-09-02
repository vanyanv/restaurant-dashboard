"use client"

import { useCallback, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  DateControl,
  Note,
  PageHead,
  Queue,
  RowLine,
  Section,
  Strip,
  Table,
  Tag,
  useCounterTransition,
  usePageChrome,
  type Column,
  type SwitchableStore,
  SubNav,
} from "@/components/counter"
import { INGREDIENT_TABS } from "@/lib/counter/nav"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { InboxCluster, IngredientsSections } from "@/lib/counter/adapters/ingredients"
import { acceptClusterMatch } from "@/lib/counter/actions/ingredient-match"

/**
 * Ingredients, composed from `P.ingredients.desk()`
 * (`docs/counter/counter-prototype.html:5772`) in the prototype's own order:
 *
 *   strip → the price monitor → a split of catalogue, review inbox and
 *   modifier mapping → a split of the worklist and the pantry.
 *
 * The adapter's docblock argues the three sections whose subject changed —
 * the frozen catalogue, an inbox with no pending proposals in it, and a
 * "needs review" queue whose real content is 43 ingredients in no recipe
 * rather than 24 unmatched lines. This file renders what it is handed and
 * prints each reason under the section it belongs to.
 */
export type CounterIngredientsSections = SectionSources<IngredientsSections>

const CATALOGUE_COLUMNS: Column[] = [
  { key: "item", label: "Ingredient" },
  { key: "vendors", label: "Vendors", numeric: true },
  { key: "price", label: "Last price", numeric: true },
  { key: "move", label: "30d", numeric: true },
  { key: "recipes", label: "Recipes", numeric: true },
]

const MODIFIER_COLUMNS: Column[] = [
  { key: "modifier", label: "Modifier" },
  { key: "sold", label: "Sold", numeric: true },
  { key: "price", label: "Price", numeric: true },
  { key: "maps", label: "Maps to" },
  { key: "state", label: "Cost" },
]

const PANTRY_COLUMNS: Column[] = [
  { key: "group", label: "Group" },
  { key: "items", label: "Items", numeric: true },
  { key: "costed", label: "Costed", numeric: true },
  { key: "spend", label: "Spend, 30d", numeric: true },
]

const ASK_SUGGESTIONS = [
  "Which ingredient prices moved most this month?",
  "How much do I buy that is in no recipe?",
  "Which invoice lines still match nothing?",
]


/**
 * A REVIEW-INBOX ROW THAT CAN ACTUALLY DECIDE.
 *
 * `P.ingredients` draws each cluster with "Accept" and "Not this", under a
 * section head reading "nothing is written until you decide". This page drew
 * the two buttons and neither decided anything: they were links, one to the
 * invoices list and one — "Not one" — to this very page, so it read as a
 * rejection and did nothing.
 *
 * The note left here said "This application has neither action: nothing in
 * the tree accepts or rejects a cluster… this section needs accept/reject
 * actions, and until it has them its second control cannot be honest. Do not
 * fix this by deleting the button again." Half of that was wrong and it is
 * the half that mattered: `confirmSkuMatch` has been in
 * `@/app/actions/ingredient-match-actions` the whole time and the editorial
 * match-picker called it. See `acceptClusterMatch`.
 *
 * ## A PICKER, NOT A SUGGESTION
 *
 * The prototype's row shows one proposed ingredient and a confidence
 * percentage. We show the catalogue and let the owner choose, because the
 * prototype's own note says why: auto-match runs in shadow mode and is right
 * about 55% of the time on genuinely new products. A single guess would be
 * wrong about half the time and would still be the one wearing the confident
 * tag. The `.mtag` here counts SPELLINGS that agree, which is a fact rather
 * than a prediction.
 *
 * ## THE SECOND BUTTON STAYS A LINK, HONESTLY
 *
 * "Not this" rejects a suggestion. With no suggestion there is nothing to
 * reject, so the second control goes where a person actually goes to find out
 * what the thing is: the invoice the line came from. It is labelled for what
 * it does. Both buttons are the design's; only their labels are ours.
 */
function InboxRow({
  cluster,
  candidates,
}: {
  cluster: InboxCluster
  candidates: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [saving, startSaving] = useTransition()
  const [choice, setChoice] = useState("")
  const [said, setSaid] = useState<string | null>(null)

  const accept = () => {
    if (choice === "") {
      setSaid("Pick the ingredient this is.")
      return
    }
    setSaid(null)
    startSaving(async () => {
      const result = await acceptClusterMatch({
        lineIds: cluster.lineIds,
        canonicalIngredientId: choice,
      })
      if (!result.ok) {
        setSaid(result.error)
        return
      }
      // The strip's unmatched count, this list, and the ingredient's own price
      // history all read the lines that just moved.
      router.refresh()
    })
  }

  return (
    <RowLine
      columns="minmax(0,1fr) 96px auto auto"
      name={cluster.name}
      sub={said ?? cluster.sub}
    >
      <Tag tone={cluster.tone}>
        {cluster.agreement} {cluster.agreement === 1 ? "way" : "ways"}
      </Tag>
      <span style={{ display: "inline-flex", gap: 7, alignItems: "center" }}>
        <select
          className="fld"
          value={choice}
          aria-label={`Match ${cluster.name} to an ingredient`}
          onChange={(e) => setChoice(e.target.value)}
        >
          <option value="">Match to…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          className="btn"
          type="button"
          style={{ padding: "5px 11px" }}
          disabled={saving}
          onClick={accept}
        >
          {saving ? "…" : "Accept"}
        </button>
      </span>
      <Link
        className="btn btn--quiet"
        style={{ padding: "5px 9px" }}
        href="/dashboard/invoices"
      >
        The lines
      </Link>
    </RowLine>
  )
}

export function CounterIngredientsClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterIngredientsSections
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
  const storeName =
    stores.find((s) => s.id === counterParams.storeId)?.name ?? "All stores"

  return (
    <>
      <PageHead title="Ingredients" sub={`${storeName} · the catalogue and what it costs`}>
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

      {/* The design's `VIEWS` bar for this family — see `INGREDIENT_TABS` in
          `@/lib/counter/nav`. Without it these siblings are pages nothing
          links to; `.seg` is not a fidelity landmark, so it changes no count. */}
      <SubNav items={INGREDIENT_TABS} label="Ingredients" />

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      <Section
        title="Price monitor"
        meta={(p) => p.meta}
        data={sections.prices}
        pending={pending}
        askAbout="which ingredient prices moved most this month"
      >
        {(p) => <Chart {...p.chart} fmt={PRICE} />}
      </Section>

      <div className="split">
        <Section
          title="Catalogue"
          meta={(c) => c.meta}
          data={sections.catalogue}
          pending={pending}
          pad={false}
        >
          {(c) => <Table columns={CATALOGUE_COLUMNS} rows={c.rows} />}
        </Section>

        <Section title="Review inbox" meta={(i) => i.meta} data={sections.inbox} pending={pending}>
          {(i) => (
            <>
              {i.clusters.map((c) => (
                <InboxRow key={c.key} cluster={c} candidates={i.candidates} />
              ))}
              <Note>
                {i.note}
              </Note>
            </>
          )}
        </Section>

        <Section
          title="Modifier mapping"
          meta={(m) => m.meta}
          data={sections.modifiers}
          pending={pending}
          pad={false}
        >
          {(m) => <Table columns={MODIFIER_COLUMNS} rows={m.rows} />}
        </Section>
      </div>

      <div className="split">
        <Section
          title="Needs review"
          meta={(w) => w.meta}
          data={sections.work}
          pending={pending}
          askAbout="how much do I buy that is in no recipe"
        >
          {(w) => <Queue items={w.items} />}
        </Section>

        <Section
          title="The pantry"
          meta={(p) => p.meta}
          data={sections.pantry}
          pending={pending}
          pad={false}
        >
          {(p) => (
            <>
              <Table columns={PANTRY_COLUMNS} rows={p.rows} />
              {/* No `.sec__body` — a table section emits the table alone, so
                  the note carries the body's own inset via `<Note flush>`. */}
              <Note flush>
                {p.note}
              </Note>
            </>
          )}
        </Section>
      </div>
    </>
  )
}

/**
 * The axis is percent change, not dollars — the adapter indexes every series to
 * its own first reading, because ground beef at $4.39 a pound and house sauce
 * at $118.71 a case cannot share a dollar scale. The legend carries the native
 * price; this writes the movement.
 */
const PRICE = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`
