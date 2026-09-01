"use client"

import { useCallback, useDeferredValue, useMemo, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  DateControl,
  Donut,
  Filters,
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
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { CatalogList, MenuCatalogSections } from "@/lib/counter/adapters/menu-catalog"

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
              <p className="mono" style={{ margin: "10px 0 0" }}>
                {c.note}
              </p>
            </>
          )}
        </Section>
      </div>
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
        count={`${shown.length} of ${total}`}
      />
      <Table columns={COLUMNS} rows={rows} />
    </>
  )
}
