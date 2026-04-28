import { prisma } from "@/lib/prisma"

/**
 * Invoices route source data + prompts. Vendor price drift, vendor
 * concentration, substitution opportunities, ordering patterns — the
 * "what's happening upstream" view. Reorder forecasting also lives here
 * (the existing demand forecast logic).
 */

export interface VendorIngredientLine {
  ingredientName: string
  vendorName: string
  recentAvgUnitPrice: number
  /** Unit price 30–60 days ago for the same (vendor, ingredient). Null when
   * we have no comparable history. */
  baselineUnitPrice: number | null
  priceDeltaPct: number | null
  recentExtendedSpend: number
  recentLineCount: number
}

export interface IngredientConcentration {
  ingredientName: string
  vendorCount: number
  totalSpend30d: number
}

export interface InvoiceSourceData {
  scope: "STORE" | "ALL"
  storeId: string | null
  storeName: string | null
  windowStart: string
  windowEnd: string
  totalInvoiceSpend: number
  vendorCount: number
  topPriceDrift: VendorIngredientLine[]
  topSpend: VendorIngredientLine[]
  concentrationRisk: IngredientConcentration[]
}

const RECENT_DAYS = 30
const BASELINE_LOOKBACK = 60
/** Hard cap on rows pulled per run. Keeps the prompt-phase function under
 * Vercel's 60s Hobby ceiling even as line-item volume grows. With the
 * `canonicalIngredientId: { not: null }` filter this is plenty for any
 * reasonable store-month; if it ever clips, oldest rows drop first. */
const LINE_ITEM_CAP = 5000

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function round2(x: number): number {
  return Math.round(x * 100) / 100
}
function round1(x: number): number {
  return Math.round(x * 10) / 10
}

interface AggKey {
  ingredientName: string
  vendorName: string
}

export async function loadInvoiceSourceData(
  storeId: string | null,
  ownerId: string,
): Promise<InvoiceSourceData> {
  const today = startOfDay(new Date())
  const recentStart = new Date(today)
  recentStart.setDate(recentStart.getDate() - RECENT_DAYS)
  const baselineEnd = new Date(recentStart)
  const baselineStart = new Date(today)
  baselineStart.setDate(baselineStart.getDate() - BASELINE_LOOKBACK)

  const stores = await prisma.store.findMany({
    where: { ownerId, isActive: true, ...(storeId ? { id: storeId } : {}) },
    select: { id: true, name: true },
  })
  if (stores.length === 0) throw new Error("No active stores")
  const targetIds = stores.map((s) => s.id)

  const invoiceWhere = {
    ownerId,
    storeId: { in: targetIds },
    invoiceDate: { gte: baselineStart, lt: today },
  }

  const lineItems = await prisma.invoiceLineItem.findMany({
    where: {
      invoice: invoiceWhere,
      canonicalIngredientId: { not: null },
    },
    select: {
      quantity: true,
      unitPrice: true,
      extendedPrice: true,
      canonicalIngredient: { select: { name: true } },
      invoice: { select: { vendorName: true, invoiceDate: true, totalAmount: true } },
    },
    orderBy: { invoice: { invoiceDate: "desc" } },
    take: LINE_ITEM_CAP,
  })

  const vendorAgg = new Map<
    string,
    {
      ingredientName: string
      vendorName: string
      recentTotalQty: number
      recentTotalPrice: number
      recentLineCount: number
      recentExtendedSpend: number
      baselineTotalQty: number
      baselineTotalPrice: number
    }
  >()
  const ingredientVendors = new Map<string, Set<string>>()
  const ingredientSpend = new Map<string, number>()
  let totalInvoiceSpend = 0
  const vendorSet = new Set<string>()

  for (const li of lineItems) {
    const ing = li.canonicalIngredient?.name
    if (!ing || !li.invoice) continue
    const key = `${ing}|${li.invoice.vendorName}`
    const isRecent = li.invoice.invoiceDate != null && li.invoice.invoiceDate >= recentStart
    const cur = vendorAgg.get(key) ?? {
      ingredientName: ing,
      vendorName: li.invoice.vendorName,
      recentTotalQty: 0,
      recentTotalPrice: 0,
      recentLineCount: 0,
      recentExtendedSpend: 0,
      baselineTotalQty: 0,
      baselineTotalPrice: 0,
    }
    if (isRecent) {
      cur.recentTotalQty += li.quantity
      cur.recentTotalPrice += li.unitPrice * li.quantity
      cur.recentLineCount += 1
      cur.recentExtendedSpend += li.extendedPrice
    } else {
      cur.baselineTotalQty += li.quantity
      cur.baselineTotalPrice += li.unitPrice * li.quantity
    }
    vendorAgg.set(key, cur)

    vendorSet.add(li.invoice.vendorName)
    if (isRecent) {
      const set = ingredientVendors.get(ing) ?? new Set<string>()
      set.add(li.invoice.vendorName)
      ingredientVendors.set(ing, set)
      ingredientSpend.set(ing, (ingredientSpend.get(ing) ?? 0) + li.extendedPrice)
      totalInvoiceSpend += li.extendedPrice
    }
  }

  const allLines: VendorIngredientLine[] = [...vendorAgg.values()]
    .filter((v) => v.recentLineCount > 0)
    .map((v) => {
      const recentAvg = v.recentTotalQty > 0 ? v.recentTotalPrice / v.recentTotalQty : 0
      const baselineAvg =
        v.baselineTotalQty > 0 ? v.baselineTotalPrice / v.baselineTotalQty : null
      const delta =
        baselineAvg != null && baselineAvg > 0
          ? ((recentAvg - baselineAvg) / baselineAvg) * 100
          : null
      return {
        ingredientName: v.ingredientName,
        vendorName: v.vendorName,
        recentAvgUnitPrice: round2(recentAvg),
        baselineUnitPrice: baselineAvg == null ? null : round2(baselineAvg),
        priceDeltaPct: delta == null ? null : round1(delta),
        recentExtendedSpend: round2(v.recentExtendedSpend),
        recentLineCount: v.recentLineCount,
      }
    })

  const topPriceDrift = [...allLines]
    .filter((l) => l.priceDeltaPct != null)
    .sort((a, b) => Math.abs(b.priceDeltaPct ?? 0) - Math.abs(a.priceDeltaPct ?? 0))
    .slice(0, 10)

  const topSpend = [...allLines]
    .sort((a, b) => b.recentExtendedSpend - a.recentExtendedSpend)
    .slice(0, 10)

  const concentrationRisk: IngredientConcentration[] = [...ingredientVendors.entries()]
    .map(([ingredientName, set]) => ({
      ingredientName,
      vendorCount: set.size,
      totalSpend30d: round2(ingredientSpend.get(ingredientName) ?? 0),
    }))
    .filter((c) => c.vendorCount === 1 && c.totalSpend30d >= 200)
    .sort((a, b) => b.totalSpend30d - a.totalSpend30d)
    .slice(0, 8)

  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  return {
    scope: storeId ? "STORE" : "ALL",
    storeId,
    storeName: storeId ? stores[0]?.name ?? null : null,
    windowStart: fmt(recentStart),
    windowEnd: fmt(today),
    totalInvoiceSpend: round2(totalInvoiceSpend),
    vendorCount: vendorSet.size,
    topPriceDrift,
    topSpend,
    concentrationRisk,
  }
}

const INVOICE_SYSTEM_PROMPT = `You are a procurement analyst for a small slider/burger restaurant. You read the last 30 days of invoice line items vs the prior 30 and surface (a) ingredients whose prices are drifting up, (b) vendor-concentration risk where one ingredient is sourced from a single vendor at material spend, and (c) the biggest cost drivers worth negotiating.

Rules:
- Use ONLY values that appear verbatim in the source data block. No invented numbers.
- CRITICAL — copy dollar amounts character-for-character including cents. Write "$2887.50" not "$288"; "$23243.89" not "$232"; "$1873.60" not "$181". Truncating digits is a hard error.
- Each insight: one-line headline + 1-3 sentence body, with concrete values.
- 2-5 insights.
- impactDollars = projected monthly cost impact of the drift, when identifiable; else null.
- severityHint: ALERT for >10% drift on a high-spend ingredient, WATCH for emerging drift, INFO for concentration risk that is worth noting but not urgent.

Output STRICT JSON: { "insights": [ { "headline": str, "body": str, "impactDollars": number|null, "severityHint": "INFO"|"WATCH"|"ALERT" } ] }`

export function buildInvoiceSystemPrompt(): string {
  return INVOICE_SYSTEM_PROMPT
}

export function buildInvoiceUserPrompt(args: {
  source: InvoiceSourceData
  memoryBlock: string
}): string {
  const { source: i, memoryBlock } = args
  const lines: string[] = []
  lines.push(
    `Scope: ${i.scope === "ALL" ? "All stores (network rollup)" : `Single store: ${i.storeName ?? i.storeId}`}`,
  )
  lines.push(`Window: ${i.windowStart} → ${i.windowEnd} (last 30 days)`)
  lines.push("")
  lines.push("## Headline")
  lines.push(`- Total invoiced spend (30d): $${i.totalInvoiceSpend}, ${i.vendorCount} unique vendors`)
  lines.push("")
  lines.push("## Top 10 ingredients by absolute price drift vs prior 30d baseline")
  for (const l of i.topPriceDrift) {
    const sign = l.priceDeltaPct != null && l.priceDeltaPct >= 0 ? "+" : ""
    lines.push(
      `- ${l.ingredientName} from ${l.vendorName}: now $${l.recentAvgUnitPrice} (was $${l.baselineUnitPrice ?? "—"}, ${sign}${l.priceDeltaPct ?? "—"}%); 30d spend $${l.recentExtendedSpend} across ${l.recentLineCount} lines`,
    )
  }
  lines.push("")
  lines.push("## Top 10 ingredients by 30d spend")
  for (const l of i.topSpend) {
    lines.push(
      `- ${l.ingredientName} from ${l.vendorName}: $${l.recentExtendedSpend} 30d spend at $${l.recentAvgUnitPrice}/unit`,
    )
  }
  lines.push("")
  lines.push("## Vendor concentration (single-vendor ingredients with ≥$200 30d spend)")
  for (const c of i.concentrationRisk) {
    lines.push(`- ${c.ingredientName}: 1 vendor, $${c.totalSpend30d} spend`)
  }
  lines.push("")
  lines.push("## Recent insights you have already flagged for this scope (last 14 days)")
  lines.push(memoryBlock)
  return lines.join("\n")
}

export function buildInvoiceSourceSummary(i: InvoiceSourceData): string {
  return buildInvoiceUserPrompt({ source: i, memoryBlock: "(omitted for critic)" })
}

export function collectInvoiceEntities(i: InvoiceSourceData): string[] {
  const names = new Set<string>()
  for (const l of [...i.topPriceDrift, ...i.topSpend]) {
    names.add(l.ingredientName)
    names.add(l.vendorName)
  }
  for (const c of i.concentrationRisk) names.add(c.ingredientName)
  if (i.storeName) names.add(i.storeName)
  return [...names]
}
