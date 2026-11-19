import { count, money, plural, points } from "@/lib/counter/format"
import type { ItemEconomics, MenuMargin } from "@/lib/counter/item-economics"

/**
 * The Menu hub "made plain" (owner's go on the mock, 2026-11-19:
 * https://claude.ai/artifact/YNwJ7EneNdAaC7vDp4HhBe, screen 1).
 *
 * Nothing is computed here that `item-economics.ts` does not already own:
 * the kept share is `menuMargin`'s margin (after deals, before the apps'
 * commission), an item's kept dollars are its `marginDollars`, and a plate's
 * keep is that over its costed units. An item with no costed row is "not
 * costed" and is never ranked, so a dish without a recipe can never read as
 * the menu's best earner or as a $0 plate.
 */

/** Plates below this many costed units are too few to call the thinnest (Menu profit's own cut). */
export const MIN_PLATES = 5
/** Rows in each ranked list. */
export const RANKED = 3

export interface MenuPlainInput {
  menu: MenuMargin
  /** The same figure over the comparison window, or null with none set or nothing sold. */
  before: MenuMargin | null
  /** "Nov 9 – 15": the comparison window, for "vs …". */
  beforeLabel: string | null
  items: ItemEconomics[]
  /** Distinct items sold in the range (the hub's own count). */
  itemsSold: number
  /** Sold items with no register-to-recipe link. */
  unmappedItems: number
  modifiers: number
  unmappedModifiers: number
}

export interface MenuPlainRank {
  key: string
  name: string
  value: string
  /** Why it is on the list, in words. */
  note?: string
}

export interface MenuPlain {
  sentence: string
  big: { label: string; value: string | null; sub: string; missing?: string }
  vs: { change: string; tone: "up" | "down" | "flat"; against: string } | null
  statuses: Array<{ tone: "good" | "warn" | "bad"; text: string }>
  earners: MenuPlainRank[]
  thinnest: MenuPlainRank[]
  needs: Array<{ key: string; what: string; why: string; act: string; href: string }>
}

const perPlate = (i: ItemEconomics) =>
  i.marginDollars !== null && i.costed && i.costed.units > 0 ? i.marginDollars / i.costed.units : null

export function buildMenuPlain(o: MenuPlainInput): MenuPlain {
  const parts: string[] = []
  const statuses: MenuPlain["statuses"] = []
  const kept = o.menu.marginPct
  const costed = o.items.filter((i) => i.marginDollars !== null && i.costed !== null)
  const notCosted = o.items.filter((i) => i.costed === null && i.units > 0)

  // The kept share and its move.
  let vs: MenuPlain["vs"] = null
  const change = kept !== null && o.before?.marginPct != null ? kept - o.before.marginPct : null
  if (kept === null) {
    parts.push("Nothing on the menu is costed in this range yet, so there is no kept figure to show.")
  } else {
    const move =
      change === null
        ? ""
        : points(change) === "flat"
          ? ", the same as before"
          : `, ${change > 0 ? "up" : "down"} ${Math.abs(change).toFixed(1)} ${Math.abs(change) === 1 ? "point" : "points"}`
    parts.push(`The menu kept ${money(kept, { cents: true })} of every $100 after food${move}.`)
    if (change !== null && o.beforeLabel) {
      const p = points(change)
      vs = { change: p, tone: p === "flat" ? "flat" : change > 0 ? "up" : "down", against: `vs ${o.beforeLabel}` }
    }
  }

  const earners = [...costed]
    .sort((a, b) => (b.marginDollars ?? 0) - (a.marginDollars ?? 0))
    .slice(0, RANKED)
    .map((i) => ({ key: i.itemName, name: i.itemName, value: money(i.marginDollars) }))
  if (earners.length > 0) parts.push(`${earners[0].name} earned the most.`)

  const thinnest = costed
    .filter((i) => (i.costed?.units ?? 0) >= MIN_PLATES && perPlate(i) !== null)
    .sort((a, b) => (perPlate(a) ?? 0) - (perPlate(b) ?? 0))
    .slice(0, RANKED)
    .map((i) => ({
      key: i.itemName,
      name: i.itemName,
      value: money(perPlate(i), { cents: true }),
      note: i.dealRunning ? "a deal is running on it" : undefined,
    }))
  if (thinnest.length > 0) {
    const t = costed.find((i) => i.itemName === thinnest[0].key)
    parts.push(`${thinnest[0].name} keeps the least per plate${t?.dealRunning ? ", because of a deal" : ""}.`)
  }

  if (notCosted.length > 0) {
    parts.push(
      `${plural(notCosted.length, "item")} sold with no cost behind ${notCosted.length === 1 ? "it" : "them"}, so ${notCosted.length === 1 ? "its" : "their"} food isn't counted.`,
    )
  }

  // Status in words.
  statuses.push({
    tone: notCosted.length === 0 ? "good" : "warn",
    text: `${count(costed.length)} of ${count(o.items.length)} items costed`,
  })
  if (notCosted.length > 0) statuses.push({ tone: "warn", text: `${count(notCosted.length)} sold, not costed` })
  if (o.unmappedModifiers > 0) statuses.push({ tone: "warn", text: `${plural(o.unmappedModifiers, "modifier")} not costed` })

  const needs: MenuPlain["needs"] = []
  if (o.unmappedItems > 0) {
    needs.push({
      key: "unmapped",
      what: `${plural(o.unmappedItems, "register item")} not linked to a recipe`,
      why: "What they sell is in sales, but their food cost is not counted.",
      act: "Link them",
      href: "/dashboard/menu/catalog",
    })
  }
  if (o.unmappedModifiers > 0) {
    needs.push({
      key: "modifiers",
      what: `${plural(o.unmappedModifiers, "modifier")} not costed`,
      why: `Of ${count(o.modifiers)} sold. An extra slice or sauce with no cost adds nothing to the plate's cost.`,
      act: "Cost them",
      href: "/dashboard/menu/catalog",
    })
  }

  return {
    sentence: parts.join(" "),
    big: {
      label: "Kept after food, per $100 sold",
      value: kept === null ? null : money(kept, { cents: true }),
      sub: "after deals, before app commission",
      missing: notCosted.length > 0 ? `${count(notCosted.length)} not costed` : undefined,
    },
    vs,
    statuses,
    earners,
    thinnest,
    needs,
  }
}
