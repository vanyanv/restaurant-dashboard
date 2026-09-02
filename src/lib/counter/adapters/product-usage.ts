import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { batchRecipeCosts } from "@/lib/recipe-cost"
import { count, money, pct, plural, titleCase } from "@/lib/counter/format"
import { rangeLabel, toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, MListRow, QueueItem, Row } from "@/components/counter"

/**
 * Product usage — `P.usage` (`docs/counter/counter-prototype.html`).
 *
 * "What the recipes say you should have used against what you actually
 * bought."
 *
 * Measured before it was written:
 * `docs/counter/measurements/2026-08-28-product-usage.md`. That comparison is
 * computable on this account and **every naive way of computing it is wrong by
 * between 2.7x and 16x.** The three that matter are argued at the functions
 * that avoid them.
 *
 * ## Dollars, not quantity
 *
 * The prototype's table is `412 lb theoretical against 448 lb purchased`.
 * Purchased quantity is in PACK units and theoretical is in RECIPE units —
 * ground beef reads 86,433 oz against 12,907, potato rolls 29,870 each against
 * 792 cases. Reconciling them needs the pack conversion, which is the most
 * error-prone number in this product and the reason `selectNonSpikeCostIndex`
 * exists. Both sides are money already; comparing money needs no conversion
 * and cannot inherit that error.
 *
 * ## And not SQL dollars either
 *
 * `SUM(quantity x costPerRecipeUnit)` is wrong too: **15 of the 91 recipe
 * ingredient lines are written in a unit the canonical is not priced in** —
 * eight `gal` against `fl oz`, seven `lb` against `oz`. Multiplying an oz
 * quantity by a per-lb cost puts ground beef at $379,441 against a real
 * $23,715. `computeIngredientLineCost` is the function that converts and
 * `batchRecipeCosts` is what runs it, so this file does no cost arithmetic of
 * its own.
 */

/** Rows in the variance table. */
const TABLE_ROWS = 10
/** Rows on the phone's list. */
const PHONE_ROWS = 3
/** A gap smaller than this share of the ingredient's spend reads as tolerance. */
const TOLERANCE_PCT = 5
/** A gap worth a queue item at all. */
const MATERIAL_DOLLARS = 500

export interface UsageHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface UsageVariance {
  rows: Row[]
  phoneRows: MListRow[]
  meta: string
  note: string
}

export interface UsageTrend {
  chart: ChartSpec
  meta: string
  note: string
}

export interface UsageWork {
  items: QueueItem[]
  meta: string
}

export interface ProductUsageSections {
  headline: SectionData<UsageHeadline>
  variance: SectionData<UsageVariance>
  trend: SectionData<UsageTrend>
  work: SectionData<UsageWork>
}

export interface ProductUsageInput {
  storeId: string | null
  accountId: string
  range: DateRange
}

/* -- loading ---------------------------------------------------------- */

interface VarianceRow {
  id: string
  name: string
  theoretical: number
  purchased: number
  gap: number
  gapPct: number | null
}

interface UsageData {
  /** `DailyCogsItem.lineCost` — the authoritative theoretical, materialised. */
  theoretical: number
  /** What the flattened walk could attribute to a named ingredient. */
  attributed: number
  purchased: number
  rows: VarianceRow[]
  /** Daily theoretical and purchased, for the chart. */
  series: Array<{ day: string; theoretical: number; purchased: number }>
  rangeLabel: string
}

/**
 * One recipe's cost per serving, flattened to LEAF ingredients.
 *
 * Attributing only a recipe's own `kind: "ingredient"` lines recovers 38% of
 * this account's theoretical cost, because every combo priced entirely from
 * sub-recipes attributes nothing — its own lines are components. Expanding
 * each component into its leaves, scaled by the component quantity, recovers
 * 80.7%.
 *
 * The memo entry is written BEFORE recursing, so a cycle terminates on the
 * empty map rather than looping. `batchRecipeCosts` already drops cyclic
 * recipes, but a walk that depends on that for termination is a walk that
 * breaks the day the upstream guard moves.
 */
function leafCosts(
  recipeId: string,
  costs: Awaited<ReturnType<typeof batchRecipeCosts>>,
  memo: Map<string, Map<string, { name: string; dollars: number }>>,
): Map<string, { name: string; dollars: number }> {
  const hit = memo.get(recipeId)
  if (hit) return hit

  const out = new Map<string, { name: string; dollars: number }>()
  memo.set(recipeId, out)

  const walked = costs.get(recipeId)
  if (!walked) return out

  for (const line of walked.lines) {
    if (line.kind === "ingredient") {
      if (line.missingCost) continue
      const entry = out.get(line.refId) ?? { name: line.name, dollars: 0 }
      entry.dollars += line.lineCost
      out.set(line.refId, entry)
      continue
    }
    for (const [id, leaf] of leafCosts(line.refId, costs, memo)) {
      const entry = out.get(id) ?? { name: leaf.name, dollars: 0 }
      entry.dollars += leaf.dollars * line.quantity
      out.set(id, entry)
    }
  }
  return out
}

async function loadUsage(input: ProductUsageInput): Promise<UsageData> {
  const { accountId, storeId, range } = input
  const { startDate, endDate } = toQueryBounds(range)

  const stores = await getScopedStores(accountId, storeId ?? null)
  const storeIds = stores.map((s) => s.id)

  const [costs, sold, purchasedByIngredient, dailyTheoretical, dailyPurchased] =
    await Promise.all([
      batchRecipeCosts(accountId),
      storeIds.length === 0
        ? Promise.resolve([])
        : prisma.$queryRaw<Array<{ rid: string; units: number; cogs: number }>>`
            SELECT "recipeId" AS rid, SUM("qtySold")::float AS units,
                   SUM("lineCost")::float AS cogs
            FROM "DailyCogsItem"
            WHERE "storeId" = ANY(${storeIds}) AND "recipeId" IS NOT NULL
              AND date >= ${startDate}::date AND date <= ${endDate}::date
            GROUP BY 1`,
      prisma.$queryRaw<Array<{ cid: string; spend: number }>>`
        SELECT li."canonicalIngredientId" AS cid, SUM(li."extendedPrice")::float AS spend
        FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
        WHERE i."accountId" = ${accountId} AND li."canonicalIngredientId" IS NOT NULL
          AND i."invoiceDate" >= ${startDate} AND i."invoiceDate" <= ${endDate}
        GROUP BY 1`,
      storeIds.length === 0
        ? Promise.resolve([])
        : prisma.$queryRaw<Array<{ d: Date; v: number }>>`
            SELECT date AS d, SUM("lineCost")::float AS v
            FROM "DailyCogsItem"
            WHERE "storeId" = ANY(${storeIds})
              AND date >= ${startDate}::date AND date <= ${endDate}::date
            GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<Array<{ d: Date; v: number }>>`
        SELECT i."invoiceDate" AS d, SUM(li."extendedPrice")::float AS v
        FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
        WHERE i."accountId" = ${accountId} AND i."invoiceDate" IS NOT NULL
          AND i."invoiceDate" >= ${startDate} AND i."invoiceDate" <= ${endDate}
        GROUP BY 1 ORDER BY 1`,
    ])

  const memo = new Map<string, Map<string, { name: string; dollars: number }>>()
  const theoreticalBy = new Map<string, { name: string; dollars: number }>()
  let attributed = 0
  for (const s of sold) {
    for (const [id, leaf] of leafCosts(s.rid, costs, memo)) {
      const dollars = leaf.dollars * s.units
      attributed += dollars
      const entry = theoreticalBy.get(id) ?? { name: leaf.name, dollars: 0 }
      entry.dollars += dollars
      theoreticalBy.set(id, entry)
    }
  }

  const purchasedBy = new Map(purchasedByIngredient.map((p) => [p.cid, p.spend]))
  const ids = new Set([...theoreticalBy.keys(), ...purchasedBy.keys()])

  const rows: VarianceRow[] = [...ids]
    .map((id) => {
      const theoretical = theoreticalBy.get(id)?.dollars ?? 0
      const purchased = purchasedBy.get(id) ?? 0
      return {
        id,
        name: theoreticalBy.get(id)?.name ?? "",
        theoretical,
        purchased,
        gap: purchased - theoretical,
        gapPct: theoretical > 0 ? ((purchased - theoretical) / theoretical) * 100 : null,
      }
    })
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))

  // Names for rows that exist only on the purchased side.
  const missing = rows.filter((r) => r.name === "").map((r) => r.id)
  if (missing.length > 0) {
    const named = await prisma.canonicalIngredient.findMany({
      where: { id: { in: missing } },
      select: { id: true, name: true },
    })
    const byId = new Map(named.map((n) => [n.id, n.name]))
    for (const r of rows) if (r.name === "") r.name = byId.get(r.id) ?? "unknown"
  }

  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const days = [
    ...new Set([...dailyTheoretical.map((r) => iso(r.d)), ...dailyPurchased.map((r) => iso(r.d))]),
  ].sort()
  const theoDay = new Map(dailyTheoretical.map((r) => [iso(r.d), r.v]))
  const buyDay = new Map(dailyPurchased.map((r) => [iso(r.d), r.v]))

  return {
    theoretical: dailyTheoretical.reduce((t, r) => t + r.v, 0),
    attributed,
    purchased: purchasedByIngredient.reduce((t, p) => t + p.spend, 0),
    rows,
    series: days.map((day) => ({
      day,
      theoretical: theoDay.get(day) ?? 0,
      purchased: buyDay.get(day) ?? 0,
    })),
    rangeLabel: rangeLabel(range, "custom"),
  }
}

/* -- helpers ---------------------------------------------------------- */

const D = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

/* -- sections --------------------------------------------------------- */

/**
 * The strip, and the cell that replaces waste.
 *
 * `Waste logged · $520 · 1.2% of COGS` is the prototype's fourth. **No table
 * in this schema matches `%waste%`** — there is no waste log, so the cell has
 * no source at all.
 *
 * What takes it is the figure this page most owes the reader: how much of the
 * theoretical cost the table below can actually attribute to a named
 * ingredient. It is **80.7%** here, and the missing fifth is recipes costed by
 * a recipe-level override — no ingredient lines under them to divide — plus
 * price drift between the day a row was materialised and today. A variance
 * table that does not say what share of the total it covers invites a reader
 * to treat the rows as the whole story.
 */
function headlineOf(d: UsageData): UsageHeadline {
  const variance = d.purchased - d.theoretical
  const coverage = d.theoretical > 0 ? (d.attributed / d.theoretical) * 100 : null

  const varianceCell: FigureProps = {
    label: "Variance",
    value: money(Math.abs(variance)),
    delta:
      d.theoretical > 0
        ? `${pct(Math.abs(variance / d.theoretical) * 100, { scaled: true })} ${variance > 0 ? "over" : "under"} theoretical`
        : "no theoretical to compare",
    deltaTone: variance > 0 ? "is-down" : "is-flat",
  }
  const coverageCell: FigureProps = {
    label: "Attributed",
    value: coverage === null ? "—" : pct(coverage, { scaled: true }),
    delta:
      coverage === null
        ? "nothing costed"
        : `${money(d.theoretical - d.attributed)} has no ingredient`,
    deltaTone: coverage !== null && coverage < 95 ? "is-down" : "is-flat",
  }

  return {
    cells: [
      {
        label: "Theoretical",
        value: money(d.theoretical),
        delta: "from recipes × units sold",
        deltaTone: "is-flat",
      },
      {
        label: "Purchased",
        value: money(d.purchased),
        delta: `invoiced over ${d.rangeLabel}`,
        deltaTone: "is-flat",
      },
      varianceCell,
      coverageCell,
    ],
    phoneCells: [varianceCell, coverageCell],
  }
}

/**
 * Where the variance sits — in DOLLARS, and the note says why.
 *
 * A reader who expects pounds will look for them, so the absence is stated
 * rather than left as a silent design choice.
 */
function varianceOf(d: UsageData): UsageVariance {
  const shown = d.rows.filter((r) => Math.abs(r.gap) >= 1).slice(0, TABLE_ROWS)
  const boughtNotUsed = d.rows.filter((r) => r.theoretical === 0 && r.purchased > 0).length

  const cause = (r: VarianceRow): string => {
    if (r.theoretical === 0) return "In no recipe"
    if (r.purchased === 0) return "Nothing bought in range"
    if (r.gapPct !== null && Math.abs(r.gapPct) < TOLERANCE_PCT) return "Within tolerance"
    return r.gap > 0 ? "Bought more than used" : "Used more than bought"
  }

  return {
    rows: shown.map((r) => ({
      key: r.id,
      href: `/dashboard/ingredients/${r.id}`,
      cells: {
        ingredient: titleCase(r.name),
        theoretical: r.theoretical === 0 ? { v: "—", cls: "hot" } : money(r.theoretical),
        purchased: r.purchased === 0 ? { v: "—", cls: "hot" } : money(r.purchased),
        gap:
          r.gapPct === null
            ? "—"
            : Math.abs(r.gapPct) < TOLERANCE_PCT
              ? `${r.gapPct > 0 ? "▲" : "▼"} ${Math.abs(r.gapPct).toFixed(0)}%`
              : {
                  v: `${r.gapPct > 0 ? "▲" : "▼"} ${Math.abs(r.gapPct).toFixed(0)}%`,
                  cls: "hot",
                },
        dollars: {
          v: `${r.gap > 0 ? "+" : "−"}${money(Math.abs(r.gap))}`,
          cls: r.gap > 0 ? "hot" : "",
        },
        cause: cause(r),
      },
    })),
    phoneRows: shown.slice(0, PHONE_ROWS).map((r) => ({
      key: r.id,
      href: `/dashboard/ingredients/${r.id}`,
      title: titleCase(r.name),
      detail: `${money(r.theoretical)} used · ${money(r.purchased)} bought`,
      value: `${r.gap > 0 ? "+" : "−"}${money(Math.abs(r.gap))}`,
      note: cause(r),
      noteTone: r.gap > 0 ? "down" : "up",
    })),
    meta: `${count(shown.length)} of ${count(d.rows.length)} · ${d.rangeLabel}`,
    note:
      `In dollars, not pounds and cases. The purchased side is in PACK units and the recipe side ` +
      `in RECIPE units, and reconciling those needs the pack conversion — the number this ` +
      `product already guards its cost paths against, because a mis-parsed pack moves a $/unit ` +
      `by 10 to 200 times. Both sides are money already, and money needs no conversion. ` +
      (boughtNotUsed > 0
        ? `${count(boughtNotUsed)} ${boughtNotUsed === 1 ? "ingredient was" : "ingredients were"} ` +
          `bought and used in no recipe at all, which is the Ingredients page's own gap seen per ` +
          `item.`
        : ""),
  }
}

/**
 * Theoretical against purchased, by day.
 *
 * The two lines are NOT expected to track each other day by day and the note
 * says so: theoretical accrues on the days a plate sold, purchased lands on
 * the days a truck arrived. Deliveries hit 14 days in 31 on this account, so a
 * purchased line is a row of spikes against a smooth theoretical one, and a
 * reader who is not told that will read every spike as an overspend.
 */
function trendOf(d: UsageData): UsageTrend {
  const days = d.series.map((s) => s.day)
  const deliveries = d.series.filter((s) => s.purchased > 0).length

  return {
    chart: {
      type: "line",
      h: 148,
      ticks: true,
      legend: true,
      labels: days.map(D),
      series: [
        {
          name: "Purchased",
          color: "var(--bad)",
          // A day with no delivery is a zero, not a gap — nothing was bought,
          // which is a reading rather than missing data.
          data: d.series.map((s) => s.purchased),
          fill: true,
        },
        {
          name: "Theoretical",
          color: "var(--ink-3)",
          data: d.series.map((s) => s.theoretical),
        },
      ],
      alt: "Theoretical and purchased cost by day",
    },
    meta:
      days.length === 0
        ? "no day in range"
        : `${count(days.length)} days · ${count(deliveries)} with a delivery`,
    note:
      `These two do not track each other day by day and are not meant to. Theoretical accrues on ` +
      `the day a plate sold; purchased lands on the day a truck arrived, and trucks came on ` +
      `${count(deliveries)} of ${count(days.length)} days. The comparison is the area under the ` +
      `two lines over the range, not the distance between them on any one day.`,
  }
}

/** What to do — from the rows that are both large and lopsided. */
function workOf(d: UsageData): UsageWork {
  const items: QueueItem[] = []

  const over = d.rows
    .filter(
      (r) =>
        r.theoretical > 0 &&
        r.gap >= MATERIAL_DOLLARS &&
        (r.gapPct ?? 0) >= TOLERANCE_PCT,
    )
    .slice(0, 2)

  for (const r of over) {
    items.push({
      key: r.id,
      tone: "warn",
      lead: `${(r.gapPct ?? 0).toFixed(0)}%`,
      unit: "over",
      title: `${titleCase(r.name)} is bought faster than it is used`,
      body:
        `${money(r.purchased)} bought against ${money(r.theoretical)} the recipes account for ` +
        `over ${d.rangeLabel} — ${money(r.gap)} of it. That is portioning, waste, or a recipe ` +
        `quantity that is lower than the kitchen actually uses; the three look identical from ` +
        `here and a scale on the line separates them.`,
      act: "Open the ingredient",
      href: `/dashboard/ingredients/${r.id}`,
    })
  }

  const unattributed = d.theoretical - d.attributed
  if (unattributed > MATERIAL_DOLLARS) {
    items.push({
      key: "coverage",
      tone: "warn",
      lead: pct(
        d.theoretical > 0 ? (unattributed / d.theoretical) * 100 : 0,
        { scaled: true },
      ),
      unit: "unattributed",
      title: "Cost with no ingredient behind it",
      body:
        `${money(unattributed)} of theoretical cost cannot be attributed to a named ingredient. ` +
        `It is recipes priced by a recipe-level override — there are no ingredient lines under ` +
        `them to divide — plus drift between the price a day was costed at and today's. Giving ` +
        `those recipes lines is what closes it.`,
      act: "Open recipes",
      href: "/dashboard/recipes",
    })
  }

  return { items, meta: `${plural(items.length, "thing")} to do` }
}

/* -- assembly --------------------------------------------------------- */

export function getProductUsageSectionPromises(
  input: ProductUsageInput,
): StreamedSections<ProductUsageSections> {
  const dataP = classify(() => loadUsage(input), {
    retryAction: "retryProductUsage",
    isEmpty: (d) => d.rows.length === 0,
    emptyReason: "no_match",
  })

  const s = <T,>(f: (d: UsageData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryProductUsage")

  return {
    headline: s(headlineOf),
    variance: s(varianceOf),
    trend: s(trendOf),
    work: s(workOf),
  }
}

export async function getProductUsageSections(
  input: ProductUsageInput,
): Promise<ProductUsageSections> {
  return awaitSections(getProductUsageSectionPromises(input))
}
