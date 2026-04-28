import { prisma } from "@/lib/prisma"

/**
 * Source-data fetcher and prompt builders for the AI Analytics Overview route.
 *
 * Overview is the morning-briefing landing page. Its source data answers the
 * question "what changed and what should the operator look at first?" — at the
 * single-store level when `storeId` is set, and at the network level (with
 * per-store comparison) when `storeId` is null.
 */

export interface OverviewKpis {
  windowLabel: string
  revenueDollars: number
  priorRevenueDollars: number
  revenueDeltaPct: number | null
  cogsDollars: number
  cogsPct: number
  priorCogsPct: number | null
  cogsDeltaPp: number | null
  targetCogsPct: number | null
  totalOrders: number
  priorTotalOrders: number
  ordersDeltaPct: number | null
}

export interface PerStoreSnapshot {
  storeId: string
  storeName: string
  revenueDollars: number
  cogsDollars: number
  cogsPct: number
  totalOrders: number
}

export interface OverviewSourceData {
  scope: "STORE" | "ALL"
  storeId: string | null
  storeName: string | null
  windowDays: number
  windowStart: string
  windowEnd: string
  kpis: OverviewKpis
  /** Only present for the all-stores rollup. */
  perStore?: PerStoreSnapshot[]
}

const WINDOW_DAYS = 7

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

interface RollupAgg {
  cogsDollars: number
  revenueDollars: number
  totalOrders: number
}

async function rollupForStore(
  storeId: string,
  start: Date,
  end: Date,
): Promise<RollupAgg> {
  const [cogsAgg, ordersAgg] = await Promise.all([
    prisma.dailyCogsItem.aggregate({
      where: { storeId, date: { gte: start, lt: end } },
      _sum: { lineCost: true, salesRevenue: true },
    }),
    prisma.otterDailySummary.aggregate({
      where: { storeId, date: { gte: start, lt: end } },
      _sum: { fpOrderCount: true, tpOrderCount: true },
    }),
  ])

  return {
    cogsDollars: cogsAgg._sum.lineCost ?? 0,
    revenueDollars: cogsAgg._sum.salesRevenue ?? 0,
    totalOrders:
      (ordersAgg._sum.fpOrderCount ?? 0) + (ordersAgg._sum.tpOrderCount ?? 0),
  }
}

export async function loadOverviewSourceData(
  storeId: string | null,
  ownerId: string,
): Promise<OverviewSourceData> {
  const today = startOfDay(new Date())
  const windowEnd = today
  const windowStart = new Date(today)
  windowStart.setDate(windowStart.getDate() - WINDOW_DAYS)
  const priorStart = new Date(windowStart)
  priorStart.setDate(priorStart.getDate() - WINDOW_DAYS)
  const priorEnd = new Date(windowStart)

  const stores = await prisma.store.findMany({
    where: { ownerId, isActive: true, ...(storeId ? { id: storeId } : {}) },
    select: { id: true, name: true, targetCogsPct: true },
  })
  if (stores.length === 0) {
    throw new Error(`No active stores found (storeId=${storeId ?? "all"})`)
  }

  const targetIds = stores.map((s) => s.id)

  const [current, prior, perStoreRollups] = await Promise.all([
    Promise.all(targetIds.map((id) => rollupForStore(id, windowStart, windowEnd))),
    Promise.all(targetIds.map((id) => rollupForStore(id, priorStart, priorEnd))),
    storeId
      ? null
      : Promise.all(
          stores.map(async (s) => {
            const r = await rollupForStore(s.id, windowStart, windowEnd)
            return {
              storeId: s.id,
              storeName: s.name,
              revenueDollars: r.revenueDollars,
              cogsDollars: r.cogsDollars,
              cogsPct: r.revenueDollars > 0 ? (r.cogsDollars / r.revenueDollars) * 100 : 0,
              totalOrders: r.totalOrders,
            } satisfies PerStoreSnapshot
          }),
        ),
  ])

  const sumCurrent: RollupAgg = current.reduce(
    (acc, c) => ({
      cogsDollars: acc.cogsDollars + c.cogsDollars,
      revenueDollars: acc.revenueDollars + c.revenueDollars,
      totalOrders: acc.totalOrders + c.totalOrders,
    }),
    { cogsDollars: 0, revenueDollars: 0, totalOrders: 0 },
  )

  const sumPrior: RollupAgg = prior.reduce(
    (acc, c) => ({
      cogsDollars: acc.cogsDollars + c.cogsDollars,
      revenueDollars: acc.revenueDollars + c.revenueDollars,
      totalOrders: acc.totalOrders + c.totalOrders,
    }),
    { cogsDollars: 0, revenueDollars: 0, totalOrders: 0 },
  )

  const cogsPct =
    sumCurrent.revenueDollars > 0
      ? (sumCurrent.cogsDollars / sumCurrent.revenueDollars) * 100
      : 0
  const priorCogsPct =
    sumPrior.revenueDollars > 0
      ? (sumPrior.cogsDollars / sumPrior.revenueDollars) * 100
      : null

  const revenueDeltaPct =
    sumPrior.revenueDollars > 0
      ? ((sumCurrent.revenueDollars - sumPrior.revenueDollars) / sumPrior.revenueDollars) * 100
      : null

  const ordersDeltaPct =
    sumPrior.totalOrders > 0
      ? ((sumCurrent.totalOrders - sumPrior.totalOrders) / sumPrior.totalOrders) * 100
      : null

  const targetCogsPct =
    storeId && stores.length === 1 ? stores[0].targetCogsPct ?? null : null

  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  return {
    scope: storeId ? "STORE" : "ALL",
    storeId,
    storeName: storeId ? stores[0]?.name ?? null : null,
    windowDays: WINDOW_DAYS,
    windowStart: fmt(windowStart),
    windowEnd: fmt(windowEnd),
    kpis: {
      windowLabel: `last ${WINDOW_DAYS} days`,
      revenueDollars: round2(sumCurrent.revenueDollars),
      priorRevenueDollars: round2(sumPrior.revenueDollars),
      revenueDeltaPct: revenueDeltaPct == null ? null : round1(revenueDeltaPct),
      cogsDollars: round2(sumCurrent.cogsDollars),
      cogsPct: round1(cogsPct),
      priorCogsPct: priorCogsPct == null ? null : round1(priorCogsPct),
      cogsDeltaPp:
        priorCogsPct == null ? null : round1(cogsPct - priorCogsPct),
      targetCogsPct,
      totalOrders: sumCurrent.totalOrders,
      priorTotalOrders: sumPrior.totalOrders,
      ordersDeltaPct: ordersDeltaPct == null ? null : round1(ordersDeltaPct),
    },
    perStore: perStoreRollups
      ? perStoreRollups.map((p) => ({
          ...p,
          revenueDollars: round2(p.revenueDollars),
          cogsDollars: round2(p.cogsDollars),
          cogsPct: round1(p.cogsPct),
        }))
      : undefined,
  }
}

function round1(x: number): number {
  return Math.round(x * 10) / 10
}
function round2(x: number): number {
  return Math.round(x * 100) / 100
}

const OVERVIEW_SYSTEM_PROMPT = `You are the morning briefing analyst for a small slider/burger restaurant operator. You read the operator's last-7-days vs prior-7-days numbers and produce a small set of crisp, opinionated insights that tell them what to look at first today.

Rules:
- Use ONLY values that appear verbatim in the source data block. Do NOT invent or derive new percentages or dollars.
- Each insight has a one-line headline and a 1-3 sentence body. The body must reference at least one concrete value from the source data.
- Cover at most 4 insights. Quality over quantity.
- Set impactDollars to the dollar magnitude of the change you are flagging when one is identifiable from the source data, otherwise null.
- Set severityHint = "ALERT" for material negative shifts, "WATCH" for emerging trends, "INFO" for context.

Output STRICT JSON: { "insights": [ { "headline": str, "body": str, "impactDollars": number|null, "severityHint": "INFO"|"WATCH"|"ALERT" } ] }`

export function buildOverviewSystemPrompt(): string {
  return OVERVIEW_SYSTEM_PROMPT
}

export function buildOverviewUserPrompt(args: {
  source: OverviewSourceData
  memoryBlock: string
}): string {
  const { source, memoryBlock } = args
  const k = source.kpis
  const lines: string[] = []
  lines.push(
    `Scope: ${source.scope === "ALL" ? "All stores (network rollup)" : `Single store: ${source.storeName ?? source.storeId}`}`,
  )
  lines.push(`Window: ${source.windowStart} → ${source.windowEnd} (${source.windowDays} days)`)
  lines.push("")
  lines.push("## Headline KPIs")
  lines.push(`- Revenue: $${k.revenueDollars} (prior 7d: $${k.priorRevenueDollars}${k.revenueDeltaPct != null ? `, ${k.revenueDeltaPct >= 0 ? "+" : ""}${k.revenueDeltaPct}%` : ""})`)
  lines.push(`- COGS: $${k.cogsDollars} = ${k.cogsPct}% of revenue${k.priorCogsPct != null ? ` (prior: ${k.priorCogsPct}%, ${k.cogsDeltaPp != null && k.cogsDeltaPp >= 0 ? "+" : ""}${k.cogsDeltaPp}pp)` : ""}`)
  if (k.targetCogsPct != null) {
    lines.push(`- COGS target: ${k.targetCogsPct}% (current is ${(k.cogsPct - k.targetCogsPct).toFixed(1)}pp ${k.cogsPct > k.targetCogsPct ? "above" : "below"} target)`)
  }
  lines.push(`- Total orders: ${k.totalOrders} (prior 7d: ${k.priorTotalOrders}${k.ordersDeltaPct != null ? `, ${k.ordersDeltaPct >= 0 ? "+" : ""}${k.ordersDeltaPct}%` : ""})`)

  if (source.perStore && source.perStore.length > 0) {
    lines.push("")
    lines.push("## Per-store breakdown (current 7d)")
    for (const p of source.perStore) {
      lines.push(`- ${p.storeName}: revenue $${p.revenueDollars}, COGS $${p.cogsDollars} (${p.cogsPct}%), ${p.totalOrders} orders`)
    }
  }

  lines.push("")
  lines.push("## Recent insights you have already flagged for this scope (last 14 days)")
  lines.push(memoryBlock)

  return lines.join("\n")
}

export function buildOverviewSourceSummary(source: OverviewSourceData): string {
  // The critic gets the same data the generator saw, just without the memory
  // block — the critic verifies support, not historical context.
  return buildOverviewUserPrompt({ source, memoryBlock: "(omitted for critic)" })
}

export function collectOverviewEntities(source: OverviewSourceData): string[] {
  const names = new Set<string>()
  if (source.storeName) names.add(source.storeName)
  if (source.perStore) {
    for (const p of source.perStore) names.add(p.storeName)
  }
  return [...names]
}
