import { prisma } from "@/lib/prisma"

/**
 * Sales route source data + prompts. Sales analytics looks at channel mix,
 * item velocity, attach rate, and day-part performance — the "where is money
 * coming from and where is it leaking" view.
 */

export interface ChannelLine {
  platform: string
  fpRevenue: number
  tpRevenue: number
  totalRevenue: number
  orderCount: number
  pctOfRevenue: number
}

export interface MenuMomentum {
  itemName: string
  category: string
  qtyCurrent: number
  qtyPrior: number
  qtyDeltaPct: number | null
  revenueCurrent: number
}

export interface SalesSourceData {
  scope: "STORE" | "ALL"
  storeId: string | null
  storeName: string | null
  windowStart: string
  windowEnd: string
  totalRevenue: number
  fpRevenue: number
  tpRevenue: number
  fpShare: number
  tpShare: number
  totalOrders: number
  averageTicket: number
  channels: ChannelLine[]
  topMomentum: MenuMomentum[]
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

export async function loadSalesSourceData(
  storeId: string | null,
  ownerId: string,
): Promise<SalesSourceData> {
  const today = startOfDay(new Date())
  const windowStart = new Date(today)
  windowStart.setDate(windowStart.getDate() - WINDOW_DAYS)
  const priorStart = new Date(windowStart)
  priorStart.setDate(priorStart.getDate() - WINDOW_DAYS)

  const stores = await prisma.store.findMany({
    where: { ownerId, isActive: true, ...(storeId ? { id: storeId } : {}) },
    select: { id: true, name: true },
  })
  if (stores.length === 0) {
    throw new Error("No active stores")
  }
  const targetIds = stores.map((s) => s.id)

  const [summaries, currentItems, priorItems] = await Promise.all([
    prisma.otterDailySummary.findMany({
      where: {
        storeId: { in: targetIds },
        date: { gte: windowStart, lt: today },
      },
      select: {
        platform: true,
        fpNetSales: true,
        tpNetSales: true,
        fpOrderCount: true,
        tpOrderCount: true,
      },
    }),
    prisma.otterMenuItem.findMany({
      where: {
        storeId: { in: targetIds },
        date: { gte: windowStart, lt: today },
        isModifier: false,
      },
      select: {
        itemName: true,
        category: true,
        fpQuantitySold: true,
        tpQuantitySold: true,
        fpTotalSales: true,
        tpTotalSales: true,
      },
    }),
    prisma.otterMenuItem.findMany({
      where: {
        storeId: { in: targetIds },
        date: { gte: priorStart, lt: windowStart },
        isModifier: false,
      },
      select: {
        itemName: true,
        category: true,
        fpQuantitySold: true,
        tpQuantitySold: true,
      },
    }),
  ])

  const channelMap = new Map<string, ChannelLine>()
  let fpRevenue = 0
  let tpRevenue = 0
  let totalOrders = 0
  for (const row of summaries) {
    const fp = row.fpNetSales ?? 0
    const tp = row.tpNetSales ?? 0
    fpRevenue += fp
    tpRevenue += tp
    totalOrders += (row.fpOrderCount ?? 0) + (row.tpOrderCount ?? 0)
    const cur = channelMap.get(row.platform) ?? {
      platform: row.platform,
      fpRevenue: 0,
      tpRevenue: 0,
      totalRevenue: 0,
      orderCount: 0,
      pctOfRevenue: 0,
    }
    cur.fpRevenue += fp
    cur.tpRevenue += tp
    cur.totalRevenue += fp + tp
    cur.orderCount += (row.fpOrderCount ?? 0) + (row.tpOrderCount ?? 0)
    channelMap.set(row.platform, cur)
  }
  const totalRevenue = fpRevenue + tpRevenue
  for (const c of channelMap.values()) {
    c.pctOfRevenue = totalRevenue > 0 ? round1((c.totalRevenue / totalRevenue) * 100) : 0
    c.fpRevenue = round2(c.fpRevenue)
    c.tpRevenue = round2(c.tpRevenue)
    c.totalRevenue = round2(c.totalRevenue)
  }
  const channels = [...channelMap.values()].sort((a, b) => b.totalRevenue - a.totalRevenue)

  const itemAgg = new Map<string, { itemName: string; category: string; qty: number; revenue: number }>()
  for (const it of currentItems) {
    const key = `${it.category}|${it.itemName}`
    const cur = itemAgg.get(key) ?? {
      itemName: it.itemName,
      category: it.category,
      qty: 0,
      revenue: 0,
    }
    cur.qty += (it.fpQuantitySold ?? 0) + (it.tpQuantitySold ?? 0)
    cur.revenue += (it.fpTotalSales ?? 0) + (it.tpTotalSales ?? 0)
    itemAgg.set(key, cur)
  }
  const priorAgg = new Map<string, number>()
  for (const it of priorItems) {
    const key = `${it.category}|${it.itemName}`
    priorAgg.set(key, (priorAgg.get(key) ?? 0) + (it.fpQuantitySold ?? 0) + (it.tpQuantitySold ?? 0))
  }

  const topMomentum = [...itemAgg.values()]
    .map((i) => {
      const key = `${i.category}|${i.itemName}`
      const prior = priorAgg.get(key) ?? 0
      const delta = prior > 0 ? ((i.qty - prior) / prior) * 100 : null
      return {
        itemName: i.itemName,
        category: i.category,
        qtyCurrent: round1(i.qty),
        qtyPrior: round1(prior),
        qtyDeltaPct: delta == null ? null : round1(delta),
        revenueCurrent: round2(i.revenue),
      }
    })
    .sort((a, b) => b.revenueCurrent - a.revenueCurrent)
    .slice(0, 10)

  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const averageTicket = totalOrders > 0 ? round2(totalRevenue / totalOrders) : 0

  return {
    scope: storeId ? "STORE" : "ALL",
    storeId,
    storeName: storeId ? stores[0]?.name ?? null : null,
    windowStart: fmt(windowStart),
    windowEnd: fmt(today),
    totalRevenue: round2(totalRevenue),
    fpRevenue: round2(fpRevenue),
    tpRevenue: round2(tpRevenue),
    fpShare: totalRevenue > 0 ? round1((fpRevenue / totalRevenue) * 100) : 0,
    tpShare: totalRevenue > 0 ? round1((tpRevenue / totalRevenue) * 100) : 0,
    totalOrders,
    averageTicket,
    channels,
    topMomentum,
  }
}

const SALES_SYSTEM_PROMPT = `You are a sales analyst for a small slider/burger restaurant. You read 7-day sales data — channel mix, item velocity, average ticket — and surface the most consequential signals an operator should act on.

Rules:
- Use ONLY values that appear verbatim in the source data block. Do NOT invent or derive new percentages or dollars.
- Each insight has a one-line headline and a 1-3 sentence body. Reference at least one concrete value.
- Cover 2-5 insights. Lean toward fewer and sharper.
- impactDollars = the dollar magnitude of the change you flag, when identifiable; otherwise null.
- severityHint: ALERT for material negative shifts, WATCH for emerging trends, INFO for context.

Output STRICT JSON: { "insights": [ { "headline": str, "body": str, "impactDollars": number|null, "severityHint": "INFO"|"WATCH"|"ALERT" } ] }`

export function buildSalesSystemPrompt(): string {
  return SALES_SYSTEM_PROMPT
}

export function buildSalesUserPrompt(args: {
  source: SalesSourceData
  memoryBlock: string
}): string {
  const { source: s, memoryBlock } = args
  const lines: string[] = []
  lines.push(
    `Scope: ${s.scope === "ALL" ? "All stores (network rollup)" : `Single store: ${s.storeName ?? s.storeId}`}`,
  )
  lines.push(`Window: ${s.windowStart} → ${s.windowEnd} (7 days)`)
  lines.push("")
  lines.push("## Headline")
  lines.push(`- Net revenue: $${s.totalRevenue} (FP $${s.fpRevenue} = ${s.fpShare}%, 3P $${s.tpRevenue} = ${s.tpShare}%)`)
  lines.push(`- Orders: ${s.totalOrders}, average ticket $${s.averageTicket}`)
  lines.push("")
  lines.push("## Channel mix (sorted by revenue)")
  for (const c of s.channels) {
    lines.push(`- ${c.platform}: $${c.totalRevenue} (${c.pctOfRevenue}% of revenue), ${c.orderCount} orders`)
  }
  lines.push("")
  lines.push("## Top 10 items by revenue with momentum vs prior 7d")
  for (const m of s.topMomentum) {
    const delta = m.qtyDeltaPct == null ? "no prior data" : `${m.qtyDeltaPct >= 0 ? "+" : ""}${m.qtyDeltaPct}%`
    lines.push(`- ${m.itemName} [${m.category}]: ${m.qtyCurrent} units / $${m.revenueCurrent} revenue (vs ${m.qtyPrior} prior, ${delta})`)
  }
  lines.push("")
  lines.push("## Recent insights you have already flagged for this scope (last 14 days)")
  lines.push(memoryBlock)
  return lines.join("\n")
}

export function buildSalesSourceSummary(s: SalesSourceData): string {
  return buildSalesUserPrompt({ source: s, memoryBlock: "(omitted for critic)" })
}

export function collectSalesEntities(s: SalesSourceData): string[] {
  const names = new Set<string>()
  for (const c of s.channels) names.add(c.platform)
  for (const m of s.topMomentum) {
    names.add(m.itemName)
    names.add(m.category)
  }
  if (s.storeName) names.add(s.storeName)
  return [...names]
}
