import { prisma } from "@/lib/prisma"

/**
 * COGS route source data + prompts. Recipe-cost drift, theoretical-vs-actual
 * variance, items at risk of breaching target COGS%, ingredient-level
 * drivers — the "what does it cost us, where is it leaking" view.
 */

export interface IngredientDriver {
  ingredientName: string
  category: string | null
  /** Approximate dollar cost contribution across the window. Source: sum of
   * `lineCost * (ingredientShareOfRecipe)` is hard without walking recipes
   * here; v1 uses `costPerRecipeUnit` as a proxy alongside `costUpdatedAt`
   * recency to flag drift. */
  costPerRecipeUnit: number | null
  recipeUnit: string | null
  costUpdatedAt: Date | null
}

export interface CogsSourceData {
  scope: "STORE" | "ALL"
  storeId: string | null
  storeName: string | null
  windowStart: string
  windowEnd: string
  cogsDollars: number
  revenueDollars: number
  cogsPct: number | null
  priorCogsPct: number | null
  cogsDeltaPp: number | null
  targetCogsPct: number | null
  partialCostDays: number
  unmappedDays: number
  topIngredientDrivers: IngredientDriver[]
}

const WINDOW_DAYS = 7

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function round1(x: number): number {
  return Math.round(x * 10) / 10
}
function round2(x: number): number {
  return Math.round(x * 100) / 100
}

export async function loadCogsSourceData(
  storeId: string | null,
  ownerId: string,
): Promise<CogsSourceData> {
  const today = startOfDay(new Date())
  const windowStart = new Date(today)
  windowStart.setDate(windowStart.getDate() - WINDOW_DAYS)
  const priorStart = new Date(windowStart)
  priorStart.setDate(priorStart.getDate() - WINDOW_DAYS)

  const stores = await prisma.store.findMany({
    where: { ownerId, isActive: true, ...(storeId ? { id: storeId } : {}) },
    select: { id: true, name: true, targetCogsPct: true },
  })
  if (stores.length === 0) throw new Error("No active stores")
  const targetIds = stores.map((s) => s.id)

  const [currentAgg, priorAgg, partial, unmapped, ingredients] =
    await Promise.all([
      prisma.dailyCogsItem.aggregate({
        where: { storeId: { in: targetIds }, date: { gte: windowStart, lt: today } },
        _sum: { lineCost: true, salesRevenue: true },
      }),
      prisma.dailyCogsItem.aggregate({
        where: { storeId: { in: targetIds }, date: { gte: priorStart, lt: windowStart } },
        _sum: { lineCost: true, salesRevenue: true },
      }),
      prisma.dailyCogsItem.count({
        where: {
          storeId: { in: targetIds },
          date: { gte: windowStart, lt: today },
          partialCost: true,
        },
      }),
      prisma.dailyCogsItem.count({
        where: {
          storeId: { in: targetIds },
          date: { gte: windowStart, lt: today },
          status: "UNMAPPED",
        },
      }),
      prisma.canonicalIngredient.findMany({
        where: { ownerId, costPerRecipeUnit: { not: null } },
        select: {
          name: true,
          category: true,
          costPerRecipeUnit: true,
          recipeUnit: true,
          costUpdatedAt: true,
        },
        orderBy: { costPerRecipeUnit: "desc" },
        take: 12,
      }),
    ])

  const cogsDollars = currentAgg._sum.lineCost ?? 0
  const revenueDollars = currentAgg._sum.salesRevenue ?? 0
  const cogsPct = revenueDollars > 0 ? (cogsDollars / revenueDollars) * 100 : null
  const priorRevenue = priorAgg._sum.salesRevenue ?? 0
  const priorCogs = priorAgg._sum.lineCost ?? 0
  const priorCogsPct = priorRevenue > 0 ? (priorCogs / priorRevenue) * 100 : null
  const cogsDeltaPp =
    cogsPct != null && priorCogsPct != null ? cogsPct - priorCogsPct : null

  const targetCogsPct =
    storeId && stores.length === 1 ? stores[0].targetCogsPct ?? null : null

  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  return {
    scope: storeId ? "STORE" : "ALL",
    storeId,
    storeName: storeId ? stores[0]?.name ?? null : null,
    windowStart: fmt(windowStart),
    windowEnd: fmt(today),
    cogsDollars: round2(cogsDollars),
    revenueDollars: round2(revenueDollars),
    cogsPct: cogsPct == null ? null : round1(cogsPct),
    priorCogsPct: priorCogsPct == null ? null : round1(priorCogsPct),
    cogsDeltaPp: cogsDeltaPp == null ? null : round1(cogsDeltaPp),
    targetCogsPct,
    partialCostDays: partial,
    unmappedDays: unmapped,
    topIngredientDrivers: ingredients.map((i) => ({
      ingredientName: i.name,
      category: i.category,
      costPerRecipeUnit: i.costPerRecipeUnit == null ? null : round2(i.costPerRecipeUnit),
      recipeUnit: i.recipeUnit,
      costUpdatedAt: i.costUpdatedAt,
    })),
  }
}

const COGS_SYSTEM_PROMPT = `You are a COGS analyst for a small slider/burger restaurant. You read 7-day cost-of-goods totals, the prior-7-day comparison, the store's target, and the top ingredient cost drivers. You surface what is breaching target, what is drifting, and which ingredient is driving the move.

Rules:
- Use ONLY values that appear verbatim in the source data block. No invented numbers.
- Each insight: one-line headline + 1-3 sentence body, with concrete values.
- 2-5 insights.
- impactDollars = dollar magnitude of the cost movement, when identifiable; else null.
- severityHint: ALERT for breaching target by >2pp or rising fast, WATCH for trends, INFO for context.

Output STRICT JSON: { "insights": [ { "headline": str, "body": str, "impactDollars": number|null, "severityHint": "INFO"|"WATCH"|"ALERT" } ] }`

export function buildCogsSystemPrompt(): string {
  return COGS_SYSTEM_PROMPT
}

export function buildCogsUserPrompt(args: {
  source: CogsSourceData
  memoryBlock: string
}): string {
  const { source: c, memoryBlock } = args
  const lines: string[] = []
  lines.push(
    `Scope: ${c.scope === "ALL" ? "All stores (network rollup)" : `Single store: ${c.storeName ?? c.storeId}`}`,
  )
  lines.push(`Window: ${c.windowStart} → ${c.windowEnd} (7 days)`)
  lines.push("")
  lines.push("## Headline")
  lines.push(
    `- Revenue $${c.revenueDollars}, COGS $${c.cogsDollars}, COGS% ${c.cogsPct ?? "—"}% (prior 7d ${c.priorCogsPct ?? "—"}%, delta ${c.cogsDeltaPp ?? "—"}pp)`,
  )
  if (c.targetCogsPct != null && c.cogsPct != null) {
    const breach = c.cogsPct - c.targetCogsPct
    lines.push(
      `- Target COGS%: ${c.targetCogsPct}% (current is ${breach >= 0 ? "+" : ""}${breach.toFixed(1)}pp vs target)`,
    )
  }
  lines.push(`- Data quality: ${c.partialCostDays} item-days had partial cost coverage; ${c.unmappedDays} item-days were unmapped`)
  lines.push("")
  lines.push("## Top ingredient cost drivers (latest cost per recipe unit)")
  for (const i of c.topIngredientDrivers) {
    lines.push(
      `- ${i.ingredientName}${i.category ? ` [${i.category}]` : ""}: $${i.costPerRecipeUnit ?? "?"} per ${i.recipeUnit ?? "?"} (cost last updated ${i.costUpdatedAt ? i.costUpdatedAt.toISOString().slice(0, 10) : "—"})`,
    )
  }
  lines.push("")
  lines.push("## Recent insights you have already flagged for this scope (last 14 days)")
  lines.push(memoryBlock)
  return lines.join("\n")
}

export function buildCogsSourceSummary(c: CogsSourceData): string {
  return buildCogsUserPrompt({ source: c, memoryBlock: "(omitted for critic)" })
}

export function collectCogsEntities(c: CogsSourceData): string[] {
  const names = new Set<string>()
  for (const i of c.topIngredientDrivers) {
    names.add(i.ingredientName)
    if (i.category) names.add(i.category)
  }
  if (c.storeName) names.add(c.storeName)
  return [...names]
}
