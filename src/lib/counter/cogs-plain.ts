import { count, delta, money, pct, plural, points } from "@/lib/counter/format"

/**
 * Food cost "made plain" (owner's go on the mock, 2026-11-18:
 * https://claude.ai/artifact/Sr98ngzuijqUUhPbJNJAv4), for the group page and
 * one store's page.
 *
 * Nothing is computed here. Cost, sales, the share and the plan are
 * `CogsWindow`'s, the same figures the strip and the verdict print; the price
 * movements are "What moved"'s own rows; the invoice backlog is the strip's.
 */

export type CogsPlainTone = "good" | "warn" | "bad"

/** Within this many points of the plan reads as "on plan", the verdict's own window. */
const ON_PLAN_WITHIN_PTS = 0.05

export interface CogsPlainMove {
  key: string
  name: string
  then: number
  now: number
  /** Percent change, already scaled (18 = 18%). */
  change: number
}

export interface CogsPlainInput {
  cost: number
  sales: number
  /** 0..100, or null with no sales. */
  foodPct: number | null
  plan: number | null
  againstPlan: number | null
  partialLines: number
  unmappedLines: number
  /** The review backlog, or null when it did not load. */
  invoices: { count: number; total: number } | null
  /** The movements "What moved" lists, biggest first; null when it did not load. */
  moves: CogsPlainMove[] | null
}

export interface CogsPlainMoveRow {
  key: string
  name: string
  prices: string
  change: string
}

export interface CogsPlain {
  sentence: string
  big: { label: string; value: string | null; sub: string; missing?: string }
  vs: { change: string; tone: "up" | "down" | "flat"; against: string } | null
  statuses: Array<{ tone: CogsPlainTone; text: string }>
  moved: CogsPlainMoveRow[]
  /** The one fix button, when invoices are waiting. */
  invoices: { what: string; href: string } | null
}

/** Rises shown in the answer. The full table is folded below. */
export const MOVES_SHOWN = 3

export function buildCogsPlain(o: CogsPlainInput): CogsPlain {
  const parts: string[] = []
  const statuses: CogsPlain["statuses"] = []
  const c = (v: number) => money(v, { cents: true })

  if (o.foodPct === null) {
    parts.push(`Food cost ${money(o.cost)}, with no sales in this range to set it against.`)
  } else {
    let plan = ""
    if (o.plan !== null && o.againstPlan !== null) {
      plan =
        Math.abs(o.againstPlan) < ON_PLAN_WITHIN_PTS
          ? `, right on your ${pct(o.plan, { scaled: true })} plan`
          : `, ${Math.abs(o.againstPlan).toFixed(1)} points ${o.againstPlan < 0 ? "under" : "over"} your ${pct(o.plan, { scaled: true })} plan`
    }
    parts.push(`Food was ${pct(o.foodPct, { scaled: true })} of sales, ${money(o.cost)}${plan}.`)
  }

  if (o.plan === null) {
    parts.push("No food-cost target is set, so there is no plan to read it against.")
    statuses.push({ tone: "warn", text: "No food-cost target set" })
  } else if (o.againstPlan !== null) {
    if (Math.abs(o.againstPlan) < ON_PLAN_WITHIN_PTS) statuses.push({ tone: "good", text: "On plan" })
    else if (o.againstPlan < 0) statuses.push({ tone: "good", text: "Under plan" })
    else statuses.push({ tone: "bad", text: "Over plan" })
  }

  const rises = (o.moves ?? []).filter((m) => m.change >= 0.05)
  if (rises.length > 0) {
    const top = rises[0]
    parts.push(`The biggest price rise is ${top.name}, ${c(top.then)} to ${c(top.now)} (${delta(top.change, { scaled: true })}).`)
  }

  const short = o.partialLines + o.unmappedLines
  if (short > 0) {
    parts.push(`${plural(short, "sold line is", "sold lines are")} not fully costed, so the true cost is higher.`)
    statuses.push({ tone: "warn", text: `${plural(short, "line")} not fully costed` })
  }

  let invoices: CogsPlain["invoices"] = null
  if (o.invoices !== null && o.invoices.count > 0) {
    const what = `${plural(o.invoices.count, "invoice")} in review, ${money(o.invoices.total)}`
    parts.push(`${plural(o.invoices.count, "invoice is", "invoices are")} still in review, so their prices are not in yet.`)
    statuses.push({ tone: "warn", text: `${plural(o.invoices.count, "invoice")} not in yet` })
    invoices = { what, href: "/dashboard/invoices" }
  }

  let vs: CogsPlain["vs"] = null
  if (o.plan !== null && o.againstPlan !== null) {
    const change = points(o.againstPlan)
    // Over plan is the bad direction.
    vs = { change, tone: change === "flat" ? "flat" : o.againstPlan > 0 ? "down" : "up", against: `against the ${pct(o.plan, { scaled: true })} plan` }
  }

  return {
    sentence: parts.join(" "),
    big: {
      label: "Food, share of sales",
      value: o.foodPct === null ? null : pct(o.foodPct, { scaled: true }),
      sub: money(o.cost),
      missing: short > 0 ? `${count(short)} not fully costed` : undefined,
    },
    vs,
    statuses,
    moved: rises.slice(0, MOVES_SHOWN).map((m) => ({
      key: m.key,
      name: m.name,
      prices: `${c(m.then)} → ${c(m.now)}`,
      change: delta(m.change, { scaled: true }),
    })),
    invoices,
  }
}
