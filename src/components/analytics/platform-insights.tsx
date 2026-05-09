"use client"

import { useMemo } from "react"
import { formatCurrency } from "@/lib/format"
import type { PlatformBreakdown } from "@/types/analytics"
import {
  Monitor,
  Globe,
  Truck,
  UtensilsCrossed,
  Banknote,
  CreditCard,
  ShoppingBag,
} from "lucide-react"

const PLATFORM_LABELS: Record<string, string> = {
  "css-pos": "Otter POS",
  "bnm-web": "Otter Online",
  doordash: "DoorDash",
  ubereats: "Uber Eats",
  grubhub: "Grubhub",
  grubhub_marketplace: "Grubhub",
  caviar: "Caviar",
}

function getChannelTone(platform: string): string {
  switch (platform) {
    case "doordash":
      return "var(--platform-doordash)"
    case "ubereats":
      return "var(--platform-ubereats)"
    case "grubhub":
    case "grubhub_marketplace":
      return "var(--platform-grubhub)"
    case "caviar":
      return "var(--platform-chownow)"
    case "css-pos":
    case "bnm-web":
      return "var(--ink)"
    default:
      return "var(--ink-muted)"
  }
}

function getChannelIcon(platform: string, paymentMethod: string | null) {
  const iconClass = "h-3.5 w-3.5"
  switch (platform) {
    case "css-pos":
      return paymentMethod === "CASH"
        ? <Banknote className={iconClass} />
        : <CreditCard className={iconClass} />
    case "bnm-web":
      return <Globe className={iconClass} />
    case "doordash":
      return <Truck className={iconClass} />
    case "ubereats":
      return <UtensilsCrossed className={iconClass} />
    case "grubhub":
    case "grubhub_marketplace":
      return <ShoppingBag className={iconClass} />
    case "caviar":
      return <UtensilsCrossed className={iconClass} />
    default:
      return <Monitor className={iconClass} />
  }
}

function getChannelLabel(platform: string, paymentMethod: string | null): string {
  const base = PLATFORM_LABELS[platform] ?? platform
  if (paymentMethod && (platform === "css-pos" || platform === "bnm-web")) {
    return `${base} (${paymentMethod})`
  }
  return base
}

interface PlatformInsightsProps {
  data: PlatformBreakdown[]
}

export function PlatformInsights({ data }: PlatformInsightsProps) {
  const channels = useMemo(() => {
    const result = data
      .filter((row) => row.grossSales > 0 || row.orderCount > 0)
      .map((row) => ({
        key: `${row.platform}-${row.paymentMethod ?? "all"}`,
        platform: row.platform,
        paymentMethod: row.paymentMethod,
        label: getChannelLabel(row.platform, row.paymentMethod),
        tone: getChannelTone(row.platform),
        grossSales: row.grossSales,
        netSales: row.netSales,
        fees: row.fees,
        orderCount: row.orderCount,
        aov: row.orderCount > 0 ? row.grossSales / row.orderCount : 0,
        feeRate: row.grossSales > 0 ? (row.fees / row.grossSales) * 100 : 0,
      }))

    const isFP = (p: string) => p === "css-pos" || p === "bnm-web"
    result.sort((a, b) => {
      const aFP = isFP(a.platform) ? 0 : 1
      const bFP = isFP(b.platform) ? 0 : 1
      if (aFP !== bFP) return aFP - bFP
      return b.grossSales - a.grossSales
    })

    return result
  }, [data])

  if (channels.length === 0) return null

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink)">
          Platform Insights
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
          performance by sales channel
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {channels.map((ch) => (
          <section
            key={ch.key}
            className="inv-panel inv-panel--flush relative overflow-hidden"
          >
            <div className="p-2.5 sm:p-3">
              <div className="flex items-center gap-1.5">
                <span style={{ color: ch.tone }}>
                  {getChannelIcon(ch.platform, ch.paymentMethod)}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint) truncate">
                  {ch.label}
                </span>
              </div>
              <div className="mt-1 space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-(--ink-muted)">AOV</span>
                  <span className="text-sm font-semibold tabular-nums">{formatCurrency(ch.aov)}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-(--ink-muted)">Fees</span>
                  <span
                    className="text-sm tabular-nums font-medium"
                    style={ch.feeRate > 15 ? { color: "var(--subtract)" } : undefined}
                  >
                    {ch.feeRate.toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-(--ink-muted)">Net</span>
                  <span className="text-[11px] tabular-nums text-(--ink-muted)">
                    {formatCurrency(ch.netSales)}
                  </span>
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
