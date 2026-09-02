"use client"

import { useCallback, useDeferredValue, useMemo, useState, useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  DateControl,
  Donut,
  Filters,
  Note,
  PageHead,
  Queue,
  Section,
  Strip,
  Table,
  Tag,
  useCounterTransition,
  usePageChrome,
  type Column,
  type FilterToggle,
  type Row,
  type SwitchableStore,
  SubNav,
} from "@/components/counter"
import { MENU_TABS } from "@/lib/counter/nav"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { rangeLabel, stepRange } from "@/lib/counter/date-range"
import { decideProposal, proposeMatches } from "@/lib/counter/actions/proposal"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
  CatalogProposals, CatalogList, MenuCatalogSections } from "@/lib/counter/adapters/menu-catalog"

/**
 * The menu catalog, composed from `P.catalog.desk()`
 * (`docs/counter/counter-prototype.html:6062`) in the prototype's own order:
 * the strip, a headless `.sec` holding the filters and the table, then the
 * split of the gaps queue and the category ring.
 *
 * ## The filters filter here, not on the server
 *
 * Every row is already in hand — sixty-one items and fifty-four modifiers —
 * so searching and toggling is a render, not a round trip. The orders page
 * puts its filters in the URL because it pages a table of thousands; this one
 * would pay a network hop to hide four rows.
 *
 * `?filter=unmapped` still seeds the toggle, because the gaps queue links here
 * with it and a link that lands on an unfiltered table has not answered the
 * question it was clicked for.
 *
 * ## The ring is drawn, and the note underneath says why not to trust it
 *
 * The POS categories do not describe the food — the biggest one holds the
 * flagship burger. The adapter's docblock argues it and writes the sentence;
 * this file renders it directly under the ring, where a reader meets the
 * caveat and the picture together.
 */
export type CounterCatalogSections = SectionSources<MenuCatalogSections>

const COLUMNS: Column[] = [
  { key: "item", label: "Item" },
  { key: "category", label: "Category" },
  { key: "price", label: "Price", numeric: true },
  { key: "sold", label: "Sold", numeric: true },
  { key: "recipe", label: "Recipe" },
  { key: "plate", label: "Plate cost", numeric: true },
  { key: "margin", label: "Margin", numeric: true },
]

const ASK_SUGGESTIONS = [
  "Which items sell with no recipe behind them?",
  "How many modifier servings go out uncosted?",
  "Which category holds the most revenue?",
]

/** Rows drawn before the table stops. The count line says what was left out. */
const MAX_ROWS = 40


const PROPOSAL_COLUMNS: Column[] = [
  { key: "item", label: "Sold as" },
  { key: "proposed", label: "Would map to" },
  { key: "why", label: "Why" },
  { key: "conf", label: "Confidence", numeric: true },
]

/**
 * REVIEWING THE AI'S MAPPING PROPOSALS.
 *
 * The prototype's card reads "Five AI mapping proposals are waiting". This
 * page's adapter note explained that `RecipeMappingProposal` holds seven
 * rejected, three accepted and nothing pending, so there was nothing behind
 * it. True of the DATA, and never true of the CAPABILITY:
 * `generateMappingProposals`, `acceptMappingProposal` and
 * `rejectMappingProposal` have all existed the whole time and the editorial
 * `proposal-review-launcher.tsx` called all three. The queue was empty because
 * nothing had ever asked it to fill.
 *
 * ## AN EMPTY QUEUE IS NOT AN EMPTY JOB
 *
 * With nothing pending the panel prints how many sold item names still carry
 * no recipe — 95 of 155 — because "nothing is waiting" and "there is nothing
 * to do" are different states and this section must not read as the second
 * when it is the first.
 *
 * ## GENERATING IS BILLED, SO THE BUTTON SAYS SO
 *
 * `generateMappingProposalsCore` resolves a normalised exact-name match for
 * free and sends only the fuzzy remainder to the model, one billed call each.
 * Nothing on this page generates on its own, and the control names the cost
 * rather than hiding it behind a verb.
 *
 * ## THREE CONTROLS, ALWAYS
 *
 * A row selects; the decision is taken once, below. Accept and Reject are
 * disabled with nothing selected rather than hidden, and Propose is always
 * live. That is a fixed landmark count on a section whose row count is
 * whatever the model last produced — the same reasoning the alert inbox and
 * the store's expense editor reached.
 */
function Proposals({ data }: { data: CatalogProposals }) {
  const router = useRouter()
  const [busy, startBusy] = useTransition()
  const [picked, setPicked] = useState<string | null>(null)
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)

  const decide = (outcome: "accept" | "reject") => {
    if (picked === null) return
    setSaid(null)
    startBusy(async () => {
      const result = await decideProposal(picked, outcome)
      if (!result.ok) {
        setSaid({ ok: false, text: `Not saved: ${result.error}.` })
        return
      }
      setPicked(null)
      // Accepting writes an OtterItemMapping, which the catalogue's mapped
      // column and every margin on the page read.
      router.refresh()
    })
  }

  const propose = () => {
    setSaid(null)
    startBusy(async () => {
      const result = await proposeMatches()
      if (!result.ok) {
        setSaid({ ok: false, text: `Could not propose: ${result.error}.` })
        return
      }
      setSaid({
        ok: true,
        text:
          result.created === 0
            ? `Nothing new to propose${result.skipped > 0 ? ` — ${result.skipped} already pending or previously rejected` : ""}.`
            : `${result.created} proposed${result.skipped > 0 ? `, ${result.skipped} skipped as already seen` : ""}.`,
      })
      router.refresh()
    })
  }

  const rows: Row[] = data.pending.map((p) => ({
    key: p.id,
    onSelect: () => setPicked(p.id),
    selected: p.id === picked,
    cells: {
      item: p.item,
      proposed: p.proposed ?? { v: "a new recipe", cls: "hot" },
      why: p.reasoning,
      conf:
        p.confidence === null
          ? { v: "exact name", cls: "hot" }
          : `${Math.round(p.confidence * 100)}%`,
    },
  }))

  return (
    <>
      {data.pending.length > 0 ? (
        <Table columns={PROPOSAL_COLUMNS} rows={rows} />
      ) : null}
      <div className="sec__body">
        <div className="btnrow">
          <button
            className="btn btn--primary"
            type="button"
            disabled={busy || picked === null}
            onClick={() => decide("accept")}
          >
            {busy ? "Saving…" : "Accept this mapping"}
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy || picked === null}
            onClick={() => decide("reject")}
          >
            Reject
          </button>
          <button
            className="btn btn--quiet"
            type="button"
            disabled={busy}
            onClick={propose}
          >
            Propose matches for the unmapped
          </button>
        </div>
        <Note tone={said && !said.ok ? "bad" : said?.ok ? "good" : undefined}>
          {said?.text ?? data.note}
        </Note>
      </div>
    </>
  )
}

export function CounterCatalogClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterCatalogSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  // `leaf` explicitly: `Topbar` defaults it to the OWNING destination's label,
  // which is "Menu" — the same word as the crumb above it, so the trail read
  // "Menu / Menu". Every route that runs deeper than its rail entry has to
  // name its own last step.
  usePageChrome({ leaf: "Catalog", askSuggestions: ASK_SUGGESTIONS })

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

  const [search, setSearch] = useState("")
  const [unmappedOnly, setUnmappedOnly] = useState(params.get("filter") === "unmapped")
  const [withModifiers, setWithModifiers] = useState(false)
  // The table redraws on every keystroke over a hundred-odd rows; deferring the
  // query keeps the input itself responsive under that.
  const query = useDeferredValue(search)

  const { range, presetId, comparisonId } = counterParams
  const storeName =
    stores.find((s) => s.id === counterParams.storeId)?.name ?? "All stores"
  const windowLabel = rangeLabel(range, "custom")

  return (
    <>
      <PageHead title="Menu catalog" sub={`${storeName} · ${windowLabel}`}>
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

      {/* The design's `VIEWS` bar for this family — see `MENU_TABS` in
          `@/lib/counter/nav`. Without it these siblings are pages nothing
          links to; `.seg` is not a fidelity landmark, so it changes no count. */}
      <SubNav items={MENU_TABS} label="Menu" />

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      {/* The prototype's own headless `.sec` — filters and table, no head. */}
      <div className="sec">
        <Section bare title="The catalog" data={sections.list} pending={pending}>
          {(l) => (
            <CatalogTable
              list={l}
              search={search}
              query={query}
              onSearch={setSearch}
              unmappedOnly={unmappedOnly}
              withModifiers={withModifiers}
              onToggle={(id) => {
                if (id === "unmapped") setUnmappedOnly((v) => !v)
                else setWithModifiers((v) => !v)
              }}
              onClear={
                search || unmappedOnly || withModifiers
                  ? () => {
                      setSearch("")
                      setUnmappedOnly(false)
                      setWithModifiers(false)
                    }
                  : undefined
              }
            />
          )}
        </Section>
      </div>

      <div className="split">
        <Section
          title="Unmapped items"
          meta={(g) => g.meta}
          data={sections.gaps}
          pending={pending}
          askAbout="how many modifier servings go out uncosted"
        >
          {(g) => <Queue items={g.items} />}
        </Section>

        <Section
          title="By category"
          meta={(c) => c.meta}
          data={sections.categories}
          pending={pending}
        >
          {(c) => (
            <>
              <Donut slices={c.slices} center={c.centre} />
              <Note>
                {c.note}
              </Note>
            </>
          )}
        </Section>
      </div>

      {/* `P.menucatalog`'s AI-proposal card, with the actions behind it. See
          `Proposals`. */}
      <Section
        title="Mapping proposals"
        meta={(p) => p.meta}
        data={sections.proposals}
        pending={pending}
        pad={false}
      >
        {(p) => <Proposals data={p} />}
      </Section>
    </>
  )
}

function CatalogTable({
  list,
  search,
  query,
  onSearch,
  unmappedOnly,
  withModifiers,
  onToggle,
  onClear,
}: {
  list: CatalogList
  search: string
  query: string
  onSearch: (next: string) => void
  unmappedOnly: boolean
  withModifiers: boolean
  onToggle: (id: string) => void
  onClear?: () => void
}) {
  const needle = query.trim().toLowerCase()
  const matching = list.rows.filter((r) => {
    if (!withModifiers && r.isModifier) return false
    if (unmappedOnly && r.mapped) return false
    if (!needle) return true
    return (
      r.item.toLowerCase().includes(needle) || r.category.toLowerCase().includes(needle)
    )
  })
  const shown = matching.slice(0, MAX_ROWS)

  const total = withModifiers ? list.rows.length : list.totalItems
  const toggles: FilterToggle[] = [
    {
      id: "unmapped",
      label: "Unmapped",
      tint: "--bad",
      pressed: unmappedOnly,
      // Ruling N-R1: a toggle that filters to nothing without saying so is
      // worse than one that prints its own zero. Both counts are real here —
      // seven items and fifteen modifiers, measured.
      count: withModifiers
        ? list.unmappedItems + list.unmappedModifiers
        : list.unmappedItems,
    },
    { id: "modifiers", label: "Modifiers", pressed: withModifiers, count: list.totalModifiers },
  ]

  const rows: Row[] = shown.map((r) => ({
    key: r.key,
    href: r.href,
    cells: {
      item: r.item,
      category: r.category,
      price: r.price,
      sold: r.sold,
      recipe: r.mapped ? <Tag tone="good">Mapped</Tag> : <Tag tone="bad">Unmapped</Tag>,
      plate: r.plateCost,
      margin: r.margin,
    },
  }))

  return (
    <>
      <Filters
        search={search}
        searchPlaceholder="Item or category"
        searchLabel="Search the catalog"
        onSearch={onSearch}
        toggles={toggles}
        onToggle={onToggle}
        onClear={onClear}
        /*
         * Both numbers, whenever the cap bites. `shown` is `matching` sliced to
         * MAX_ROWS, so `${shown.length} of ${total}` told a reader who filtered
         * 500 items down to 200 that their filter had matched 40 — the cap
         * reported as the result. This is the form `/dashboard/invoices`
         * already uses for the same list-with-a-cap problem.
         */
        count={
          shown.length === matching.length
            ? `${matching.length} of ${total}`
            : `${shown.length} of ${matching.length} shown`
        }
      />
      <Table columns={COLUMNS} rows={rows} />
    </>
  )
}
