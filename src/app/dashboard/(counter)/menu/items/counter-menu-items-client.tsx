"use client"

import Link from "next/link"
import { useCallback, useDeferredValue, useMemo, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  DateControl,
  MenuPhoto,
  PageHead,
  Section,
  SubNav,
  useCounterTransition,
  usePageChrome,
  type SwitchableStore,
} from "@/components/counter"
import { MENU_TABS } from "@/lib/counter/nav"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { rangeLabel, stepRange } from "@/lib/counter/date-range"
import { count, pct } from "@/lib/counter/format"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { ItemGlyph, MenuItemsData, MenuItemsSections } from "@/lib/counter/adapters/menu-items"

/**
 * Menu items: the owner's menu as dishes. Tiles, then what needs the owner
 * (biggest money first), then every dish with its photo, plate cost and food
 * cost. A row opens the dish's one-screen page.
 *
 * Built from the 2026-10-27 "Menu item creation" design, in the Shop and
 * Store checks parts: the same glyphs mean the same thing on every screen.
 */

const ASK_SUGGESTIONS = [
  "Which menu items have the highest food cost?",
  "What does a Double Slider cost to make?",
  "Which dishes are not fully costed?",
]

const GLYPH: Record<ItemGlyph, { cls: string; mark: string; label: string }> = {
  ok: { cls: "ck-gl--ok", mark: "✓", label: "Fully costed" },
  open: { cls: "ck-gl--open", mark: "◷", label: "Needs your eye" },
  miss: { cls: "ck-gl--miss", mark: "✕", label: "Selling, not costed" },
  up: { cls: "ck-gl--up", mark: "·", label: "Not sold in this range" },
}

function Glyph({ glyph, title, small }: { glyph: ItemGlyph; title?: string; small?: boolean }) {
  const g = GLYPH[glyph]
  return (
    <span
      className={`ck-gl ${g.cls}${small ? " ck-gl--sm" : ""}`}
      role="img"
      aria-label={title ?? g.label}
      title={title ?? g.label}
    >
      {g.mark}
    </span>
  )
}

export function CounterMenuItemsClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: SectionSources<MenuItemsSections>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  usePageChrome({ leaf: "Items", askSuggestions: ASK_SUGGESTIONS })
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
      <PageHead title="Menu items" sub={`${storeName} · ${rangeLabel(range, "custom")} · photos from chrisneddys.com`}>
        <DateControl
          presetId={presetId}
          comparisonId={comparisonId}
          range={range}
          onPreset={(id) => push({ presetId: id })}
          onComparison={(id) => push({ comparisonId: id })}
          onStep={(direction) => push({ range: stepRange(range, direction) })}
          onRange={(next) => push({ range: next })}
        />
        <Link className="btn btn--primary" href="/dashboard/menu/items/new">
          New menu item
        </Link>
      </PageHead>
      <SubNav items={MENU_TABS} label="Menu" />

      <Section bare title="Menu items" data={sections.items} pending={pending}>
        {(d) => <Body data={d} />}
      </Section>
    </>
  )
}

function Body({ data }: { data: MenuItemsData }) {
  const c = data.counts
  const foodCost = c.revenue > 0 ? c.cost / c.revenue : null
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="sh-tiles">
        <a className={`sh-tile${c.notCosted > 0 ? " sh-tile--bad" : ""}`} href="#needs">
          <span className="k">Selling, not costed</span>
          <span className="v">{count(c.notCosted)}</span>
          <span className="s">
            {c.notCosted > 0 ? `${count(c.notCostedSold)} sold with nothing counted for food` : "Every dish that sold has a recipe"}
          </span>
        </a>
        <a className="sh-tile" href="#all">
          <span className="k">Fully costed</span>
          <span className="v">
            {count(c.fullyCosted)} of {count(c.sellingDishes)}
          </span>
          <span className="s">Dishes that sold with every line priced</span>
        </a>
        <div className="sh-tile">
          <span className="k">Food cost</span>
          <span className="v">{pct(foodCost)}</span>
          <span className="s">Of what costed items collected, after discounts</span>
        </div>
        <a className="sh-tile" href="#needs">
          <span className="k">Prices to check</span>
          <span className="v">{count(c.staleIngredients)}</span>
          <span className="s">{c.staleExample ? `${c.staleExample} and others, priced 90+ days ago` : "Every ingredient priced in the last 90 days"}</span>
        </a>
      </div>

      <section className="sec" aria-labelledby="needs">
        <div className="mi-tools">
          <b id="needs" style={{ fontSize: "var(--t-mid)" }}>
            Needs you
          </b>
          <span className="ck-meta">
            {data.needs.length === 0 ? "Nothing waiting" : `${count(data.needs.length)} · biggest effect on food cost first`}
          </span>
        </div>
        {data.needs.length === 0 ? (
          <p className="mi-empty">Every dish that sold is costed from its recipe and recent prices.</p>
        ) : (
          <div className="mi-needs">
            {data.needs.map((n) => (
              <div className="mi-need" key={n.key}>
                <Glyph glyph={n.glyph} />
                <MenuPhoto frame={n.photo} alt={n.title} />
                <Link className="who" href={n.act.href}>
                  <b>{n.title}</b>
                  <span className="ck-mono">{n.sub}</span>
                </Link>
                <span className="what">{n.what}</span>
                <span className="amt">{n.amount}</span>
                <Link className={`btn${n.glyph === "miss" ? " btn--primary" : ""}`} href={n.act.href}>
                  {n.act.label}
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <AllItems data={data} />

      <div className="ck-legend">
        {(["ok", "open", "miss", "up"] as const).map((g) => (
          <span key={g}>
            <Glyph glyph={g} small />
            {GLYPH[g].label}
          </span>
        ))}
      </div>
    </div>
  )
}

function AllItems({ data }: { data: MenuItemsData }) {
  const [category, setCategory] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const query = useDeferredValue(search).trim().toLowerCase()
  const rows = data.items.filter(
    (r) => (!category || r.category === category) && (!query || r.name.toLowerCase().includes(query)),
  )

  return (
    <section className="sec" aria-labelledby="all">
      <div className="mi-tools">
        <b id="all" style={{ fontSize: "var(--t-mid)" }}>
          All {count(data.items.length)} dishes
        </b>
        <div className="mi-chips" role="group" aria-label="Filter by group">
          <button type="button" className="mi-chip" aria-pressed={category === null} onClick={() => setCategory(null)}>
            All
          </button>
          {data.categories.map((cat) => (
            <button
              type="button"
              key={cat}
              className="mi-chip"
              aria-pressed={category === cat}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
        <input
          className="mi-search"
          type="search"
          placeholder="Find a dish"
          aria-label="Find a dish"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="mi-wrap">
        <table className="mi-tbl">
          <thead>
            <tr>
              <th aria-label="Status" />
              <th>Dish</th>
              <th className="num">Avg price</th>
              <th className="num">Plate cost</th>
              <th>Food cost</th>
              <th className="num">Keep per plate</th>
              <th className="num">Sold</th>
              <th className="num">POS names</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="mi-empty">
                  No dish matches.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Glyph glyph={r.glyph} title={r.why} small />
                  </td>
                  <td>
                    <Link className="mi-dish" href={r.href}>
                      <MenuPhoto frame={r.photo} alt={r.name} />
                      <span>
                        <b>{r.name}</b>
                        <span className="ck-meta">{r.category}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="num">{r.avgPrice}</td>
                  <td className="num">{r.plateCost}</td>
                  <td>
                    <span className="mi-bar" aria-hidden="true">
                      <i
                        className={r.foodCostPct != null && r.foodCostPct > 0.35 ? "hi" : undefined}
                        style={{ width: `${Math.min(100, (r.foodCostPct ?? 0) * 200)}%` }}
                      />
                    </span>
                    {r.foodCost}
                  </td>
                  <td className="num">
                    <b>{r.keep}</b>
                  </td>
                  <td className="num">{r.soldLabel}</td>
                  <td className="num">{count(r.posNames)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
