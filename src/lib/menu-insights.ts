import type { MenuPerformanceData, QuickInsight } from "@/types/analytics"

const LOW_SELLER_THRESHOLD = 5
const WOW_DROP_THRESHOLD = -20
// Require the previous period to have had at least this much volume before we
// call a drop a "drop"; keeps the insight from surfacing noise from tiny items.
const WOW_DROP_MIN_PREV_QTY = 5

export function buildMenuInsights(data: MenuPerformanceData): QuickInsight[] {
  const insights: QuickInsight[] = []

  // 1. Aggregate revenue WoW — only emit when the prior period had meaningful
  //    revenue, otherwise the % is meaningless.
  const { comparison } = data
  if (comparison.previousRevenue > 0) {
    const pct = comparison.revenueGrowth
    const absPct = Math.abs(pct).toFixed(1)
    if (pct >= 5) {
      insights.push({
        id: "agg-revenue-up",
        type: "positive",
        text: `Revenue up ${absPct}% vs prior window`,
      })
    } else if (pct <= -5) {
      insights.push({
        id: "agg-revenue-down",
        type: "negative",
        text: `Revenue down ${absPct}% vs prior window`,
      })
    } else {
      insights.push({
        id: "agg-revenue-flat",
        type: "info",
        text: `Revenue within 5% of prior window`,
      })
    }
  }

  // 2. Top seller — most-sold item by quantity.
  const top = [...data.allItems].sort(
    (a, b) => b.totalQuantitySold - a.totalQuantitySold
  )[0]
  if (top && top.totalQuantitySold > 0) {
    insights.push({
      id: "top-seller",
      type: "info",
      text: `Top seller: ${top.itemName} (${top.totalQuantitySold.toLocaleString()} sold)`,
    })
  }

  // 3. Low performers — items on the menu that barely moved in the window.
  const lowCount = data.allItems.filter(
    (i) => i.totalQuantitySold < LOW_SELLER_THRESHOLD
  ).length
  if (lowCount > 0) {
    insights.push({
      id: "low-performers",
      type: "warning",
      text: `${lowCount} item${lowCount === 1 ? "" : "s"} sold under ${LOW_SELLER_THRESHOLD}× in window`,
    })
  }

  // 4. Per-item WoW drops — items with ≥ 20% volume drop, with enough prior
  //    volume to be worth flagging. Name the top 1–2 culprits.
  const drops = data.allItems
    .filter(
      (i) =>
        i.quantityGrowth != null &&
        i.quantityGrowth <= WOW_DROP_THRESHOLD &&
        i.previousQuantity >= WOW_DROP_MIN_PREV_QTY
    )
    .sort((a, b) => (a.quantityGrowth ?? 0) - (b.quantityGrowth ?? 0))
  if (drops.length > 0) {
    const names = drops
      .slice(0, 2)
      .map((d) => d.itemName)
      .join(", ")
    const suffix =
      drops.length > 2 ? ` +${drops.length - 2} more` : ""
    insights.push({
      id: "wow-drops",
      type: "negative",
      text: `${drops.length} item${drops.length === 1 ? "" : "s"} dropped >20% WoW: ${names}${suffix}`,
    })
  }

  return insights
}
