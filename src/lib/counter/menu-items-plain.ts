import { count, pct, plural } from "@/lib/counter/format"
import type { ItemGlyph, MenuItemsData, MenuItemRow, NeedRow } from "@/lib/counter/adapters/menu-items"

/**
 * Menu > Items "made plain" (owner's go, 2026-11-19; mock
 * https://claude.ai/artifact/YNwJ7EneNdAaC7vDp4HhBe, screen 2).
 *
 * Words only: every figure is `MenuItemsData`'s, the same counts the tiles
 * print and the same per-dish strings the table prints. A dish with no
 * costed sale reads "not costed", never a $0 plate.
 */

export type ItemsPlainTone = "good" | "warn" | "bad" | "wait"

/** A dish's status in words, and the tone it is drawn in. */
export const STATUS_WORDS: Record<ItemGlyph, { text: string; tone: ItemsPlainTone }> = {
  ok: { text: "Costed", tone: "good" },
  open: { text: "Needs your eye", tone: "warn" },
  miss: { text: "Not costed", tone: "bad" },
  up: { text: "Not sold", tone: "wait" },
}

export interface ItemsPlainDish {
  key: string
  name: string
  href: string
  category: string
  glyph: ItemGlyph
  /** "costs $2.37 · sells $7.99 · 30% food", or why there are no figures. */
  detail: string
  /** Kept per plate, or "not costed". */
  keep: string
  status: { text: string; tone: ItemsPlainTone }
  why: string
}

export interface ItemsPlainGroup {
  key: string
  what: string
  why: string
  act: { label: string; href: string }
}

export interface ItemsPlain {
  sentence: string
  big: { label: string; value: string | null; sub: string; missing?: string }
  statuses: Array<{ text: string; tone: ItemsPlainTone }>
  needs: ItemsPlainGroup[]
  /** Dishes that sold, most sold first; unsold ones last. */
  dishes: ItemsPlainDish[]
  /** Chip filters, in order: status first, then the menu's own groups. */
  filters: Array<{ key: string; label: string; n: number }>
}

function dish(r: MenuItemRow): ItemsPlainDish {
  const costed = r.glyph === "ok" || r.glyph === "open"
  return {
    key: r.id,
    name: r.name,
    href: r.href,
    category: r.category,
    glyph: r.glyph,
    detail:
      r.sold === 0
        ? "not sold in this range"
        : costed
          ? `costs ${r.plateCost} · sells ${r.avgPrice} · ${r.foodCost} food`
          : `sold ${r.soldLabel} · no recipe yet`,
    keep: costed && r.sold > 0 ? r.keep : "not costed",
    status: STATUS_WORDS[r.glyph],
    why: r.why,
  }
}

function group(key: string, rows: NeedRow[], what: string): ItemsPlainGroup | null {
  if (rows.length === 0) return null
  const top = rows[0]
  return {
    key,
    what,
    why: rows.length === 1 ? top.what : `${top.title} first: ${top.what}`,
    act: { label: rows.length === 1 ? top.act.label : `Start with ${top.title}`, href: top.act.href },
  }
}

export function buildItemsPlain(d: MenuItemsData): ItemsPlain {
  const c = d.counts
  const foodCost = c.revenue > 0 ? c.cost / c.revenue : null
  const parts: string[] = []

  if (c.sellingDishes === 0) parts.push("No dish sold in this range.")
  else {
    parts.push(
      `${count(c.fullyCosted)} of ${count(c.sellingDishes)} dishes that sold are fully costed` +
        (foodCost === null ? "." : `, and food was ${pct(foodCost)} of what they collected.`),
    )
  }
  if (c.notCosted > 0) {
    parts.push(
      `${plural(c.notCosted, "dish", "dishes")} sold ${count(c.notCostedSold)} times with nothing counted for food, so ${c.notCosted === 1 ? "it needs" : "they need"} a recipe first.`,
    )
  }
  if (c.staleIngredients > 0) {
    parts.push(
      `${plural(c.staleIngredients, "ingredient price")} ${c.staleIngredients === 1 ? "is" : "are"} more than 90 days old${c.staleExample ? `, ${c.staleExample} among them` : ""}.`,
    )
  }

  const statuses: ItemsPlain["statuses"] = []
  if (c.sellingDishes > 0) {
    statuses.push({
      tone: c.fullyCosted === c.sellingDishes ? "good" : "warn",
      text: `${count(c.fullyCosted)} of ${count(c.sellingDishes)} fully costed`,
    })
  }
  if (c.notCosted > 0) statuses.push({ tone: "bad", text: `${count(c.notCosted)} selling, not costed` })
  if (c.staleIngredients > 0) statuses.push({ tone: "warn", text: `${plural(c.staleIngredients, "old price")}` })

  const miss = d.needs.filter((n) => n.glyph === "miss")
  const open = d.needs.filter((n) => n.glyph === "open")
  const needs = [
    group("miss", miss, `${plural(miss.length, "dish", "dishes")} selling with no recipe`),
    group("open", open, `${plural(open.length, "dish", "dishes")} to check`),
  ].filter((g): g is ItemsPlainGroup => g !== null)

  const dishes = [...d.items].sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name)).map(dish)
  const by = (g: ItemGlyph) => dishes.filter((x) => x.glyph === g).length
  const filters = [
    { key: "all", label: "All", n: dishes.length },
    { key: "miss", label: "Not costed", n: by("miss") },
    { key: "open", label: "Needs your eye", n: by("open") },
    ...d.categories.map((cat) => ({ key: `cat:${cat}`, label: cat, n: dishes.filter((x) => x.category === cat).length })),
  ].filter((f) => f.key === "all" || f.n > 0)

  return {
    sentence: parts.join(" "),
    big: {
      label: "Food cost, dishes that sold",
      value: foodCost === null ? null : pct(foodCost),
      sub: "of what costed dishes collected, after deals",
      missing: c.notCosted > 0 ? `${count(c.notCosted)} not costed` : undefined,
    },
    statuses,
    needs,
    dishes,
    filters,
  }
}

/** Whether a dish shows under the chip `key`. */
export function matchesFilter(x: ItemsPlainDish, key: string): boolean {
  if (key === "all") return true
  if (key === "miss" || key === "open") return x.glyph === key
  return key.startsWith("cat:") && x.category === key.slice(4)
}
