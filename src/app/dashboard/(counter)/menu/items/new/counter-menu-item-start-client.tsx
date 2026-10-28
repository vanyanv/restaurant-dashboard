"use client"

import Link from "next/link"
import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { MenuPhoto, PageHead, Section, SubNav, usePageChrome } from "@/components/counter"
import { MENU_TABS } from "@/lib/counter/nav"
import { count } from "@/lib/counter/format"
import { linkSellingItem, startMenuItem } from "@/lib/counter/actions/menu-item"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
  MenuItemStartData,
  MenuItemStartSections,
  RecipeChoice,
  SellingRow,
} from "@/lib/counter/adapters/menu-item-start"

/**
 * New menu item. Three ways in, in the order an owner meets them: a POS item
 * that is already selling with nothing counted for food, a copy of a dish
 * they already make, or a blank recipe. Every start lands on the dish's own
 * page, where the lines, portions and cost are edited.
 *
 * Menu items are the same at every store, so there is no store picker here.
 */

const ASK_SUGGESTIONS = ["Which items are selling with no recipe?", "What does a Double Slider cost to make?"]

export function CounterMenuItemStartClient({
  sections,
  focusPos,
}: {
  sections: SectionSources<MenuItemStartSections>
  focusPos: string | null
}) {
  usePageChrome({ leaf: "New item", askSuggestions: ASK_SUGGESTIONS })
  return (
    <>
      <PageHead title="New menu item" sub="Same at every store · start from what you already sell">
        <Link className="btn" href="/dashboard/menu/items">
          Back to menu items
        </Link>
      </PageHead>
      <SubNav items={MENU_TABS} label="Menu" />
      <Section bare title="New menu item" data={sections.start}>
        {(d) => <Body data={d} focusPos={focusPos} />}
      </Section>
    </>
  )
}

function Body({ data, focusPos }: { data: MenuItemStartData; focusPos: string | null }) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Run one start; on success (or a partial success that still made the
  // recipe) open the dish's page.
  const run = (fn: () => Promise<{ ok: boolean; recipeId?: string | null; error: string | null }>) => {
    setError(null)
    startTransition(async () => {
      try {
        const r = await fn()
        if (r.recipeId) {
          // A partial success still opens the recipe; the message rides along
          // so the dish page can say what is left to do.
          const warn = r.ok ? "" : `&warn=${encodeURIComponent(r.error ?? "Not every step finished.")}`
          router.push(`/dashboard/recipes/${r.recipeId}?new=1${warn}`)
          return
        }
        if (!r.ok) setError(r.error ?? "That did not save. Try again.")
        else router.refresh()
      } catch {
        setError("That did not reach the server. Check the connection and try again.")
      }
    })
  }

  const selling = useMemo(() => {
    if (!focusPos) return data.selling
    const hit = data.selling.filter((s) => s.name === focusPos)
    return [...hit, ...data.selling.filter((s) => s.name !== focusPos)]
  }, [data.selling, focusPos])

  return (
    <div style={{ display: "grid", gap: 16 }} aria-busy={busy}>
      {error ? (
        <p className="ct-note ct-note--bad ct-note--bare" role="alert">
          {error}
        </p>
      ) : null}

      <section className="sec" aria-labelledby="selling">
        <div className="mi-tools">
          <b id="selling" style={{ fontSize: "var(--t-mid)" }}>
            Already selling, no recipe
          </b>
          <span className="ck-meta">
            {selling.length === 0
              ? "Every POS item that sold in the last 30 days has a recipe"
              : `${count(selling.length)} · last 30 days, all stores · biggest first`}
          </span>
        </div>
        {selling.length === 0 ? (
          <p className="mi-empty">Nothing is selling without a recipe.</p>
        ) : (
          <div className="mi-needs">
            {selling.map((s) => (
              <SellingItem
                key={`${s.name}\u0000${s.category}`}
                row={s}
                focused={s.name === focusPos}
                dishes={data.copy}
                busy={busy}
                onMake={() => run(() => startMenuItem({ itemName: s.name, category: s.category, posName: s.name }))}
                onLink={(recipeId) =>
                  run(async () => {
                    const r = await linkSellingItem({ otterItemName: s.name, recipeId })
                    return r.ok ? { ok: true, recipeId: null, error: null } : { ok: false, recipeId: null, error: r.error }
                  })
                }
              />
            ))}
          </div>
        )}
      </section>

      {data.empty.length > 0 ? (
        <section className="sec" aria-labelledby="empty">
          <div className="mi-tools">
            <b id="empty" style={{ fontSize: "var(--t-mid)" }}>
              Recipes with nothing in them
            </b>
            <span className="ck-meta">{count(data.empty.length)} · each sale counts $0 of food until lines are added</span>
          </div>
          <div className="mi-needs">
            {data.empty.map((r) => (
              <div className="mi-need" key={r.id}>
                <span className="ck-gl ck-gl--miss" role="img" aria-label="Not costed">
                  ✕
                </span>
                <MenuPhoto frame={r.photo} alt={r.name} />
                <Link className="who" href={`/dashboard/recipes/${r.id}`}>
                  <b>{r.name}</b>
                  <span className="ck-mono">{r.category}</span>
                </Link>
                <span className="what">No lines and no typed-in cost</span>
                <span className="amt">{r.sold > 0 ? `${count(r.sold)} sold` : "—"}</span>
                <Link className="btn btn--primary" href={`/dashboard/recipes/${r.id}`}>
                  Add lines
                </Link>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <NewDish data={data} busy={busy} onStart={(input) => run(() => startMenuItem(input))} />
    </div>
  )
}

function SellingItem({
  row,
  focused,
  dishes,
  busy,
  onMake,
  onLink,
}: {
  row: SellingRow
  focused: boolean
  dishes: RecipeChoice[]
  busy: boolean
  onMake: () => void
  onLink: (recipeId: string) => void
}) {
  const [linkTo, setLinkTo] = useState("")
  return (
    <div className="mi-need mi-need--start" aria-current={focused || undefined}>
      <span className="ck-gl ck-gl--miss" role="img" aria-label="Selling, not costed">
        ✕
      </span>
      <MenuPhoto frame={row.photo} alt={row.name} />
      <span className="who">
        <b>{row.name}</b>
        <span className="ck-mono">
          {row.category} · {row.soldLabel} · {row.revenue}
        </span>
      </span>
      <label className="ck-field mi-link">
        <span className="ck-mono">Or it is a dish you have</span>
        <select
          className="ck-input"
          value={linkTo}
          onChange={(e) => setLinkTo(e.target.value)}
          aria-label={`Dish that ${row.name} is`}
        >
          <option value="">Pick a dish…</option>
          {dishes.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn" disabled={busy || !linkTo} onClick={() => onLink(linkTo)}>
        Link
      </button>
      <button type="button" className="btn btn--primary" disabled={busy} onClick={onMake}>
        Make its recipe
      </button>
    </div>
  )
}

function NewDish({
  data,
  busy,
  onStart,
}: {
  data: MenuItemStartData
  busy: boolean
  onStart: (input: { itemName: string; category: string; copyFrom: string | null }) => void
}) {
  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [copyFrom, setCopyFrom] = useState<string | null>(null)
  const source = data.copy.find((d) => d.id === copyFrom) ?? null

  const pick = (d: RecipeChoice | null) => {
    setCopyFrom(d?.id ?? null)
    if (d && !category) setCategory(d.category)
  }

  return (
    <section className="sec" aria-labelledby="newdish">
      <div className="mi-tools">
        <b id="newdish" style={{ fontSize: "var(--t-mid)" }}>
          A new dish
        </b>
        <span className="ck-meta">Copy one you make now and change what is different, or start blank</span>
      </div>
      <form
        className="sh-form"
        onSubmit={(e) => {
          e.preventDefault()
          onStart({ itemName: name, category: category || source?.category || "", copyFrom })
        }}
      >
        <div className="row">
          <label className="ck-field">
            <span className="ck-mono">Name on the menu</span>
            <input
              className="ck-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="The Reverse Bun"
              required
            />
          </label>
          <label className="ck-field">
            <span className="ck-mono">Group</span>
            <input
              className="ck-input"
              list="mi-groups"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={source?.category ?? "Sliders"}
            />
            <datalist id="mi-groups">
              {data.categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <button type="submit" className="btn btn--primary" disabled={busy || !name.trim()}>
            {source ? `Create from ${source.name}` : "Create blank"}
          </button>
        </div>
        <p className="ck-meta" style={{ margin: 0 }}>
          {source
            ? `Starts with ${count(source.lines)} line${source.lines === 1 ? "" : "s"} from ${source.name}. Nothing on ${source.name} changes.`
            : "Pick a dish below to start from its lines, or create it blank."}
        </p>
      </form>

      <div className="mi-cards" role="radiogroup" aria-label="Start from">
        <button type="button" role="radio" aria-checked={copyFrom === null} className="mi-card" onClick={() => pick(null)}>
          <MenuPhoto frame={null} alt="Blank" className="mi-photo--fill" />
          <b>Blank</b>
          <span className="ck-meta">No lines yet</span>
        </button>
        {data.copy.map((d) => (
          <button
            type="button"
            role="radio"
            aria-checked={copyFrom === d.id}
            key={d.id}
            className="mi-card"
            onClick={() => pick(d)}
          >
            <MenuPhoto frame={d.photo} alt={d.name} className="mi-photo--fill" />
            <b>{d.name}</b>
            <span className="ck-meta">
              {count(d.lines)} line{d.lines === 1 ? "" : "s"}
              {d.sold > 0 ? ` · ${count(d.sold)} sold` : ""}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
