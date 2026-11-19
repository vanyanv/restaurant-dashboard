import { count, pct } from "@/lib/counter/format"
import type { MenuEngineeringData, MenuEngineeringRow, MenuQuadrant } from "@/app/actions/forecasts/menu-engineering-actions"

/**
 * Menu > Profit "made plain" (owner's go, 2026-11-19; mock
 * https://claude.ai/artifact/YNwJ7EneNdAaC7vDp4HhBe, screen 5).
 *
 * The volume-against-margin chart's four corners ARE the answer, so they are
 * named in words. The quadrants, the food-cost share and the coverage are
 * `getMenuEngineering`'s own (the chart, the ledger and the strip read the
 * same object); only costed items are classified, so an item with no recipe
 * is never called a star.
 */

/** Names shown per group. */
export const GROUP_NAMES = 3

export interface ProfitPlainGroup {
  key: MenuQuadrant
  title: string
  /** What the group is, in a few words. */
  hint: string
  names: string[]
  more: number
  tone: "good" | "warn" | "bad" | "wait"
}

export interface ProfitPlain {
  sentence: string
  big: { label: string; value: string | null; sub: string; missing?: string }
  statuses: Array<{ tone: "good" | "warn"; text: string }>
  groups: ProfitPlainGroup[]
}

const GROUPS: Array<{ key: MenuQuadrant; title: string; hint: string; tone: ProfitPlainGroup["tone"] }> = [
  { key: "STAR", title: "Keep selling", hint: "sells a lot, keeps a lot", tone: "good" },
  { key: "PLOWHORSE", title: "Look at price", hint: "sells a lot, keeps little", tone: "warn" },
  { key: "PUZZLE", title: "Push more", hint: "keeps a lot, sells less", tone: "wait" },
  { key: "DOG", title: "Think about", hint: "sells little, keeps little", tone: "bad" },
]

const byUnits = (a: MenuEngineeringRow, b: MenuEngineeringRow) => b.soldQty - a.soldQty || a.itemName.localeCompare(b.itemName)

export function buildProfitPlain(d: MenuEngineeringData): ProfitPlain {
  const costedRows = d.rows.filter((r) => r.marginPct !== null)
  const groups: ProfitPlainGroup[] = GROUPS.map((g) => {
    const rows = costedRows.filter((r) => r.quadrant === g.key).sort(byUnits)
    return {
      ...g,
      names: rows.slice(0, GROUP_NAMES).map((r) => r.itemName),
      more: Math.max(0, rows.length - GROUP_NAMES),
    }
  })

  const food = d.menu.foodCostPct
  const parts: string[] = []
  parts.push(
    food === null
      ? "Nothing on the menu is costed in this range, so there is no food cost to read."
      : `Food cost was ${pct(food, { scaled: true })} of menu sales, after deals.`,
  )
  const star = groups[0].names[0]
  const plow = groups[1].names[0]
  if (star) parts.push(`Push ${star}, which sells a lot and keeps a lot.`)
  if (plow) parts.push(`Look at ${plow}, which sells a lot but keeps little.`)

  const notCosted = Math.max(0, 100 - d.coverage.coveragePct)
  const statuses: ProfitPlain["statuses"] = [
    {
      tone: notCosted < 0.05 ? "good" : "warn",
      text: `${pct(d.coverage.coveragePct, { scaled: true })} of sales costed`,
    },
  ]
  if (costedRows.length > 0) statuses.push({ tone: "good", text: `${count(costedRows.length)} items sorted into four groups` })

  return {
    sentence: parts.join(" "),
    big: {
      label: "Food cost, share of menu sales",
      value: food === null ? null : pct(food, { scaled: true }),
      sub: "of what costed items collected, after deals",
      missing: notCosted >= 0.05 ? `${pct(notCosted, { scaled: true })} of sales not costed` : undefined,
    },
    statuses,
    groups,
  }
}
