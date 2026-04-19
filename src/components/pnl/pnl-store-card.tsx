import Link from "next/link"
import { ArrowRight, Store as StoreIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

function formatDollar(v: number): string {
  const abs = Math.abs(v)
  const str = abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return v < 0 ? `-$${str}` : `$${str}`
}

const CHANNEL_COLORS: Record<string, string> = {
  "Credit Cards": "bg-blue-500",
  Cash: "bg-emerald-500",
  Uber: "bg-black dark:bg-white",
  DoorDash: "bg-red-500",
  Grubhub: "bg-orange-500",
  ChowNow: "bg-amber-500",
  "EZ Cater": "bg-purple-500",
  Fooda: "bg-pink-500",
  "Otter Online": "bg-indigo-500",
  "Otter Prepaid": "bg-violet-500",
  Beverage: "bg-sky-500",
}

export interface PnLStoreCardProps {
  storeId: string
  storeName: string
  grossSales: number
  bottomLine: number
  marginPct: number
  channelMix: Array<{ channel: string; amount: number }>
  fixedCostsConfigured: boolean
}

export function PnLStoreCard({
  storeId,
  storeName,
  grossSales,
  bottomLine,
  marginPct,
  channelMix,
  fixedCostsConfigured,
}: PnLStoreCardProps) {
  const mixTotal = channelMix.reduce((a, b) => a + b.amount, 0)

  return (
    <Link href={`/dashboard/pnl/${storeId}`} className="group">
      <Card className="transition-colors hover:border-primary/50 hover:shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <StoreIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="font-semibold truncate">{storeName}</div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground shrink-0" />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Gross Sales
              </div>
              <div className="text-lg font-bold tabular-nums">
                {formatDollar(grossSales)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Bottom Line
              </div>
              <div
                className={cn(
                  "text-lg font-bold tabular-nums",
                  bottomLine < 0 && "text-red-600 dark:text-red-400"
                )}
              >
                {formatDollar(bottomLine)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {(marginPct * 100).toFixed(1)}% margin
              </div>
            </div>
          </div>

          {mixTotal > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Channel Mix
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                {channelMix.map((c) => (
                  <div
                    key={c.channel}
                    className={cn("h-full", CHANNEL_COLORS[c.channel] ?? "bg-gray-400")}
                    style={{ width: `${(c.amount / mixTotal) * 100}%` }}
                    title={`${c.channel}: ${formatDollar(c.amount)}`}
                  />
                ))}
              </div>
            </div>
          )}

          {!fixedCostsConfigured && (
            <div className="mt-3 text-[11px] text-amber-600 dark:text-amber-400">
              Labor &amp; rent not configured
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
