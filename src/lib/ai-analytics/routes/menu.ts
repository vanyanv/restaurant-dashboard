import { prisma } from "@/lib/prisma"

/**
 * Menu route source data + prompts. Per-menu-item profitability — quantity,
 * revenue, COGS, contribution. Surfaces stars / dogs / margin compression /
 * pricing-test candidates.
 */

export interface MenuItemLine {
  itemName: string
  category: string
  qtySold: number
  revenue: number
  cogs: number
  contributionDollars: number
  /** Margin % at the item line (revenue - cogs) / revenue * 100. */
  marginPct: number | null
  /** Indicates the recipe walk only partially costed this item — number is
   * an undercount of true COGS. */
  partialCost: boolean
}

export interface MenuSourceData {
  scope: "STORE" | "ALL"
  storeId: string | null
  storeName: string | null
  windowStart: string
  windowEnd: string
  totalRevenue: number
  totalCogs: number
  totalContribution: number
  marginPct: number | null
  topByContribution: MenuItemLine[]
  bottomByMargin: MenuItemLine[]
  unmappedItemsCount: number
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

export async function loadMenuSourceData(
  storeId: string | null,
  ownerId: string,
): Promise<MenuSourceData> {
  const today = startOfDay(new Date())
  const windowStart = new Date(today)
  windowStart.setDate(windowStart.getDate() - WINDOW_DAYS)

  const stores = await prisma.store.findMany({
    where: { ownerId, isActive: true, ...(storeId ? { id: storeId } : {}) },
    select: { id: true, name: true },
  })
  if (stores.length === 0) throw new Error("No active stores")
  const targetIds = stores.map((s) => s.id)

  const [costed, unmapped] = await Promise.all([
    prisma.dailyCogsItem.findMany({
      where: {
        storeId: { in: targetIds },
        date: { gte: windowStart, lt: today },
        status: "COSTED",
      },
      select: {
        itemName: true,
        category: true,
        qtySold: true,
        salesRevenue: true,
        lineCost: true,
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
  ])

  const itemAgg = new Map<
    string,
    { itemName: string; category: string; qty: number; revenue: number; cogs: number; partial: boolean }
  >()
  for (const r of costed) {
    const key = `${r.category}|${r.itemName}`
    const cur = itemAgg.get(key) ?? {
      itemName: r.itemName,
      category: r.category,
      qty: 0,
      revenue: 0,
      cogs: 0,
      partial: false,
    }
    cur.qty += r.qtySold
    cur.revenue += r.salesRevenue
    cur.cogs += r.lineCost
    cur.partial = cur.partial || r.partialCost
    itemAgg.set(key, cur)
  }

  const lines: MenuItemLine[] = [...itemAgg.values()].map((i) => {
    const contribution = i.revenue - i.cogs
    return {
      itemName: i.itemName,
      category: i.category,
      qtySold: round1(i.qty),
      revenue: round2(i.revenue),
      cogs: round2(i.cogs),
      contributionDollars: round2(contribution),
      marginPct: i.revenue > 0 ? round1((contribution / i.revenue) * 100) : null,
      partialCost: i.partial,
    }
  })

  const totalRevenue = lines.reduce((s, l) => s + l.revenue, 0)
  const totalCogs = lines.reduce((s, l) => s + l.cogs, 0)
  const totalContribution = totalRevenue - totalCogs
  const marginPct = totalRevenue > 0 ? round1((totalContribution / totalRevenue) * 100) : null

  const topByContribution = [...lines]
    .sort((a, b) => b.contributionDollars - a.contributionDollars)
    .slice(0, 10)
  const bottomByMargin = [...lines]
    .filter((l) => l.qtySold >= 5 && l.marginPct != null)
    .sort((a, b) => (a.marginPct ?? 0) - (b.marginPct ?? 0))
    .slice(0, 8)

  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  return {
    scope: storeId ? "STORE" : "ALL",
    storeId,
    storeName: storeId ? stores[0]?.name ?? null : null,
    windowStart: fmt(windowStart),
    windowEnd: fmt(today),
    totalRevenue: round2(totalRevenue),
    totalCogs: round2(totalCogs),
    totalContribution: round2(totalContribution),
    marginPct,
    topByContribution,
    bottomByMargin,
    unmappedItemsCount: unmapped,
  }
}

const MENU_SYSTEM_PROMPT = `You are a menu engineering analyst for a small slider/burger restaurant. You read item-level sales and COGS data and surface (a) which items earn their slot, (b) which compress margin, and (c) what the operator should consider repricing, repromoting, or pulling.

Rules:
- Use ONLY values that appear verbatim in the source data block. Do NOT invent or derive new percentages or dollars.
- Each insight: one-line headline + 1-3 sentence body referencing concrete values.
- 2-5 insights. Quality over quantity.
- impactDollars = dollar magnitude of the issue, when identifiable; else null.
- severityHint: ALERT for material margin compression, WATCH for trends, INFO for context.

Output STRICT JSON: { "insights": [ { "headline": str, "body": str, "impactDollars": number|null, "severityHint": "INFO"|"WATCH"|"ALERT" } ] }`

export function buildMenuSystemPrompt(): string {
  return MENU_SYSTEM_PROMPT
}

export function buildMenuUserPrompt(args: {
  source: MenuSourceData
  memoryBlock: string
}): string {
  const { source: m, memoryBlock } = args
  const lines: string[] = []
  lines.push(
    `Scope: ${m.scope === "ALL" ? "All stores (network rollup)" : `Single store: ${m.storeName ?? m.storeId}`}`,
  )
  lines.push(`Window: ${m.windowStart} → ${m.windowEnd} (7 days)`)
  lines.push("")
  lines.push("## Headline")
  lines.push(`- Costed revenue: $${m.totalRevenue}, COGS $${m.totalCogs}, contribution $${m.totalContribution} (${m.marginPct ?? "—"}% margin)`)
  lines.push(`- Unmapped/uncosted item-days: ${m.unmappedItemsCount} (these are excluded from the table below)`)
  lines.push("")
  lines.push("## Top 10 items by contribution dollars")
  for (const l of m.topByContribution) {
    const partial = l.partialCost ? " [partialCost]" : ""
    lines.push(
      `- ${l.itemName} [${l.category}]: ${l.qtySold} units, revenue $${l.revenue}, COGS $${l.cogs}, contribution $${l.contributionDollars} (${l.marginPct ?? "—"}% margin)${partial}`,
    )
  }
  lines.push("")
  lines.push("## Bottom 8 items by margin (min 5 units sold)")
  for (const l of m.bottomByMargin) {
    const partial = l.partialCost ? " [partialCost]" : ""
    lines.push(
      `- ${l.itemName} [${l.category}]: ${l.marginPct}% margin, $${l.contributionDollars} contribution on ${l.qtySold} units${partial}`,
    )
  }
  lines.push("")
  lines.push("## Recent insights you have already flagged for this scope (last 14 days)")
  lines.push(memoryBlock)
  return lines.join("\n")
}

export function buildMenuSourceSummary(m: MenuSourceData): string {
  return buildMenuUserPrompt({ source: m, memoryBlock: "(omitted for critic)" })
}

export function collectMenuEntities(m: MenuSourceData): string[] {
  const names = new Set<string>()
  for (const l of [...m.topByContribution, ...m.bottomByMargin]) {
    names.add(l.itemName)
    names.add(l.category)
  }
  if (m.storeName) names.add(m.storeName)
  return [...names]
}
