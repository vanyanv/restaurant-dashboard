"use client"

import { useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
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

const CHANNEL_COLORS: Record<string, string> = {
  "css-pos__CARD": "hsl(20, 91%, 48%)",
  "css-pos__CASH": "hsl(35, 85%, 45%)",
  "bnm-web__CARD": "hsl(262, 83%, 58%)",
  "bnm-web__CASH": "hsl(280, 70%, 50%)",
  doordash: "hsl(0, 72%, 51%)",
  ubereats: "hsl(142, 71%, 45%)",
  grubhub: "hsl(25, 95%, 53%)",
  grubhub_marketplace: "hsl(25, 95%, 53%)",
  caviar: "hsl(210, 70%, 50%)",
}

function getChannelColor(platform: string, paymentMethod: string | null): string {
  const isFP = platform === "css-pos" || platform === "bnm-web"
  if (isFP && paymentMethod) {
    return CHANNEL_COLORS[`${platform}__${paymentMethod}`] ?? "hsl(221, 83%, 53%)"
  }
  return CHANNEL_COLORS[platform] ?? "hsl(221, 83%, 53%)"
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
    // Use each PlatformBreakdown entry directly (already split by channel + paymentMethod)
    const result = data
      .filter((row) => row.grossSales > 0 || row.orderCount > 0)
      .map((row) => ({
        key: `${row.platform}-${row.paymentMethod ?? "all"}`,
        platform: row.platform,
        paymentMethod: row.paymentMethod,
        label: getChannelLabel(row.platform, row.paymentMethod),
        color: getChannelColor(row.platform, row.paymentMethod),
        grossSales: row.grossSales,
        netSales: row.netSales,
        fees: row.fees,
        orderCount: row.orderCount,
        aov: row.orderCount > 0 ? row.grossSales / row.orderCount : 0,
        feeRate: row.grossSales > 0 ? (row.fees / row.grossSales) * 100 : 0,
      }))

    // Sort: FP first, then by gross sales desc
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
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Platform Insights</h3>
        <p className="text-xs text-muted-foreground">
          Performance by sales channel
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {channels.map((ch) => (
          <Card
            key={ch.key}
            className="relative overflow-hidden border-l-[3px]"
            style={{ borderLeftColor: ch.color }}
          >
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground" style={{ color: ch.color }}>
                  {getChannelIcon(ch.platform, ch.paymentMethod)}
                </span>
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground truncate">
                  {ch.label}
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-muted-foreground">AOV</span>
                  <span className="text-sm font-semibold tabular-nums">{formatCurrency(ch.aov)}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-muted-foreground">Fees</span>
                  <span
                    className="text-sm tabular-nums font-medium"
                    style={{ color: ch.feeRate > 15 ? "hsl(0, 72%, 51%)" : "inherit" }}
                  >
                    {ch.feeRate.toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-muted-foreground">Net</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {formatCurrency(ch.netSales)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
