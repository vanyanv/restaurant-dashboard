"use client"

import Link from "next/link"
import { useCallback, useMemo, useState, useTransition} from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  DateControl,
  Note,
  PageHead,
  Section,
  Strip,
  Table,
  Tag,
  useCounterTransition,
  usePageChrome,
  type Column,
  type Row,
  type SwitchableStore,
} from "@/components/counter"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { dataOf } from "@/lib/counter/section-data"
import { stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import { mapItemToRecipe } from "@/lib/counter/actions/menu-item"
import type { ItemBehind, MenuItemSections } from "@/lib/counter/adapters/menu-item"

/**
 * One POS item, composed from `P.catalogitem.desk()`
 * (`docs/counter/counter-prototype.html:6934`): the strip, the units chart,
 * then the split of the channel table and what is behind the item.
 *
 * Two of the channel table's columns read "not recorded for this range" on
 * every row, and the section's note says why — no order in the window carries
 * a commission. That is the Orders page's answer to the same gap, in the same
 * words. The adapter's docblock has the measurement.
 */
export type CounterMenuItemSections = SectionSources<MenuItemSections>

const CHANNEL_COLUMNS: Column[] = [
  { key: "channel", label: "Channel" },
  { key: "price", label: "Price", numeric: true },
  { key: "sold", label: "Sold", numeric: true },
  { key: "commission", label: "Commission", numeric: true },
  { key: "net", label: "Net each", numeric: true },
  // Named for what it IS. "Margin" alone would read as a net margin, which is
  // the one thing this window cannot compute.
  { key: "margin", label: "Margin on plate", numeric: true },
]

const ASK_SUGGESTIONS = [
  "Which channel sells this item best?",
  "What does this item cost to make?",
  "Which modifiers go out with this item?",
]

/**
 * MAPPING THE ITEM TO ITS RECIPE — the join everything downstream needs.
 *
 * A recipe mapped to a sold item is what makes a plate cost, a margin and a
 * COGS attribution possible for it. **60 of this account's 155 distinct sold
 * item names are mapped: 39%.** The other 95 sell every day and cost nothing
 * the product can see.
 *
 * This section's only control was a `.btn--primary` reading "Map N of these
 * modifiers", or "Open the recipe" when there were none, and both navigated to
 * `/dashboard/recipes` and mapped nothing. `mapOtterItemToRecipe` has always
 * existed and the editorial recipe canvas called it.
 *
 * The button count does not change: the primary slot becomes the real control
 * and the adapter now supplies one action, the way back. Two `.btn`, as
 * before.
 *
 * THE MODIFIERS ARE STILL ONLY COUNTED, and the note says so rather than
 * offering a control that cannot finish. `mapOtterSubItemToRecipe` needs a
 * `skuId` this page does not carry; a button that could not complete is the
 * thing this codebase does not ship, and it is what the old primary was.
 */
function Behind({ b }: { b: ItemBehind }) {
  const router = useRouter()
  const [saving, startSaving] = useTransition()
  const [recipeId, setRecipeId] = useState("")
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)

  const map = () => {
    if (recipeId === "") {
      setSaid({ ok: false, text: "Pick the recipe that makes this." })
      return
    }
    setSaid(null)
    startSaving(async () => {
      const result = await mapItemToRecipe({
        otterItemName: b.otterItemName,
        recipeId,
      })
      if (!result.ok) {
        setSaid({ ok: false, text: `Not mapped: ${result.error}.` })
        return
      }
      // The plate cost, the margin and the channel table on this page all read
      // the mapping that was just written, and so does the catalogue behind it.
      router.refresh()
    })
  }

  return (
    <>
      {b.rows.map((r) => (
        <div className="setrow" key={r.key}>
          <div className="tx">
            <b>{r.title}</b>
            <span>{r.detail}</span>
          </div>
          {r.mapped ? <Tag tone="good">Mapped</Tag> : <Tag tone="bad">No recipe</Tag>}
        </div>
      ))}

      <div className="editrow" style={{ gridTemplateColumns: "1fr", marginTop: 11 }}>
        <select
          className="fld"
          value={recipeId}
          aria-label="Recipe that makes this item"
          onChange={(e) => setRecipeId(e.target.value)}
        >
          <option value="">
            {b.mapped ? "Change the recipe to…" : "This is made by…"}
          </option>
          {b.recipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <div className="btnrow" style={{ marginTop: 12 }}>
        <button
          className="btn btn--primary"
          type="button"
          disabled={saving}
          onClick={map}
        >
          {saving ? "Mapping…" : b.mapped ? "Change the recipe" : "Map it to this recipe"}
        </button>
        {b.actions.map((a) => (
          <Link key={a.href} className="btn" href={a.href}>
            {a.label}
          </Link>
        ))}
      </div>

      <Note tone={said && !said.ok ? "bad" : undefined}>
        {said?.text ??
          (b.unmappedModifiers > 0
            ? `The mapping is written for every store, because an item name belongs to the POS ` +
              `rather than a location. ${b.unmappedModifiers} of the modifiers sold with this ` +
              `item still have no recipe; mapping one needs a SKU this page does not carry.`
            : `The mapping is written for every store, because an item name belongs to the POS ` +
              `rather than a location.`)}
      </Note>
    </>
  )
}

export function CounterMenuItemClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: MenuItemSections
}) {
  // `dataOf` — the head is already resolved (this route awaits its sections,
  // see the page's own note), and unwrapping it is not a status branch.
  const head = dataOf(sections.headline)
  const title = head?.title ?? "A menu item"

  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  // `leaf` is the item, not "Menu" — a detail route names the record, which is
  // what the crumb trail is for.
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
  const storeName =
    stores.find((s) => s.id === counterParams.storeId)?.name ?? "All stores"

  return (
    <>
      <PageHead title={title} sub={head?.sub ?? storeName}>
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

      {/* `pad` default and `askAbout`: the prototype's fourth argument to
          `sec()` is ASK, not padding — `sec('Units sold', …, chart({…}), true)`
          asks about the section by its title, and a chart body is not `raw()`
          so it keeps its `.sec__body`. */}
      <Section
        title="Units sold"
        meta={(s) => s.meta}
        data={sections.series}
        pending={pending}
        askAbout
      >
        {(s) => <Chart {...s.chart} />}
      </Section>

      <div className="split">
        <Section
          title="By channel"
          meta={(c) => c.meta}
          data={sections.channels}
          pending={pending}
          askAbout="which channel sells this item best"
          /* `tbl()` returns `raw()` in the prototype, so a section whose body
             is a table has no `.sec__body`. The note below carries the body's
             own inset via `<Note flush>`, as the Menu profit ledger's does. */
          pad={false}
        >
          {(c) => (
            <>
              <Table
                columns={CHANNEL_COLUMNS}
                rows={c.rows.map<Row>((r) => ({
                  key: r.key,
                  cells: {
                    channel: (
                      <span className="chip" style={{ ["--pc" as string]: r.tint }}>
                        <i />
                        {r.channel}
                      </span>
                    ),
                    price: r.price,
                    sold: r.sold,
                    commission: r.commission,
                    net: r.netEach,
                    margin: r.margin,
                  },
                }))}
              />
              <Note flush>
                {c.note}
              </Note>
            </>
          )}
        </Section>

        <Section
          title="Behind it"
          meta={(b) => b.meta}
          data={sections.behind}
          pending={pending}
        >
          {(b) => <Behind b={b} />}
        </Section>
      </div>
    </>
  )
}
