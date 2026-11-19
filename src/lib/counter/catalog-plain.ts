import { count, plural } from "@/lib/counter/format"
import type { CatalogList, CatalogProposals } from "@/lib/counter/adapters/menu-catalog"

/**
 * Menu > Catalog "made plain" (owner's go, 2026-11-19; mock
 * https://claude.ai/artifact/YNwJ7EneNdAaC7vDp4HhBe, screen 3).
 *
 * The page exists to link register items to recipes, so the links come
 * first, one tap each. Every count is `CatalogList`'s; a likely match is a
 * pending mapping proposal onto a recipe that already exists. A proposal
 * that would CREATE a recipe is never one tap: its lines need reading, so
 * that row says "Pick a recipe" and opens the item.
 */

/** Rows shown in the to-link list before the fold. */
export const TO_LINK_SHOWN = 8

export interface CatalogPlainLink {
  key: string
  item: string
  sold: string
  /** A one-tap match: accept this proposal. */
  match: { proposalId: string; recipe: string } | null
  href: string
}

export interface CatalogPlain {
  sentence: string
  big: { label: string; value: string; sub: string }
  statuses: Array<{ tone: "good" | "warn"; text: string }>
  toLink: CatalogPlainLink[]
  more: number
}

export function buildCatalogPlain(list: CatalogList, proposals: CatalogProposals | null): CatalogPlain {
  const items = list.rows.filter((r) => !r.isModifier)
  const unlinked = items.filter((r) => !r.mapped).sort((a, b) => b.soldQty - a.soldQty)
  const linked = items.length - unlinked.length
  const modsLinked = list.totalModifiers - list.unmappedModifiers

  const byItem = new Map<string, { id: string; proposed: string }>()
  for (const p of proposals?.pending ?? []) {
    if (!p.creates && p.proposed !== null && !byItem.has(p.item)) byItem.set(p.item, { id: p.id, proposed: p.proposed })
  }
  const toLink: CatalogPlainLink[] = unlinked.map((r) => {
    const m = byItem.get(r.item)
    return {
      key: r.key,
      item: r.item,
      sold: `${r.sold} sold`,
      match: m ? { proposalId: m.id, recipe: m.proposed } : null,
      href: r.href,
    }
  })
  const matches = toLink.filter((l) => l.match).length

  const parts: string[] = []
  if (unlinked.length === 0) parts.push("Every register item that sold is linked to a recipe, so all of it is costed.")
  else {
    parts.push(
      `${plural(unlinked.length, "register item")} ${unlinked.length === 1 ? "isn't" : "aren't"} linked to a recipe, so what ${unlinked.length === 1 ? "it sells isn't" : "they sell isn't"} costed.`,
    )
    if (matches > 0) parts.push(`There is a likely match for ${matches === unlinked.length && matches > 1 ? "all of them" : `${count(matches)} of them`}.`)
  }
  if (list.unmappedModifiers > 0) {
    parts.push(`${plural(list.unmappedModifiers, "modifier")} ${list.unmappedModifiers === 1 ? "has" : "have"} no cost yet.`)
  }

  const statuses: CatalogPlain["statuses"] = [
    { tone: unlinked.length === 0 ? "good" : "warn", text: `${count(linked)} of ${count(items.length)} items linked` },
  ]
  if (list.totalModifiers > 0) {
    statuses.push({
      tone: list.unmappedModifiers === 0 ? "good" : "warn",
      text: `${count(modsLinked)} of ${count(list.totalModifiers)} modifiers linked`,
    })
  }

  return {
    sentence: parts.join(" "),
    big: {
      label: "Linked to a recipe",
      value: `${count(linked)} of ${count(items.length)}`,
      sub: `${count(list.totalModifiers)} modifiers · ${count(modsLinked)} linked`,
    },
    statuses,
    toLink: toLink.slice(0, TO_LINK_SHOWN),
    more: Math.max(0, toLink.length - TO_LINK_SHOWN),
  }
}
