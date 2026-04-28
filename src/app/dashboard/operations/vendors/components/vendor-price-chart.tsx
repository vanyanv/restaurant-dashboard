"use client"

import { useState, useMemo } from "react"
import {
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "@/components/charts/recharts"
import { EditorialChartTooltip } from "@/components/charts/editorial-chart-tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency, formatDate } from "@/lib/format"
import type { VendorPriceTrend } from "@/types/product-usage"

interface VendorPriceChartProps {
  data: VendorPriceTrend[]
}

// Editorial vendor stroke palette: ink + supporting tints. Vendors beyond 4
// loop through hairline-bold (greys) so the chart never clashes.
const VENDOR_STROKES = [
  "var(--chart-ink)",
  "var(--chart-accent)",
  "var(--chart-subtract)",
  "var(--chart-muted)",
]

const NUM_CLASS =
  "[font-variant-numeric:tabular-nums_lining-nums] [font-feature-settings:'tnum','lnum']"

export function VendorPriceChart({ data }: VendorPriceChartProps) {
  const [selectedProduct, setSelectedProduct] = useState<string>(
    data[0]?.productName ?? ""
  )

  const selected = useMemo(
    () => data.find((d) => d.productName === selectedProduct) ?? null,
    [data, selectedProduct]
  )

  const { vendors, chartData } = useMemo(() => {
    if (!selected || selected.dataPoints.length === 0) {
      return { vendors: [] as string[], chartData: [] as Record<string, unknown>[] }
    }

    const vendorSet = new Set<string>()
    for (const dp of selected.dataPoints) {
      vendorSet.add(dp.vendor)
    }
    const vendorList = Array.from(vendorSet)

    const byDate = new Map<string, Record<string, unknown>>()
    for (const dp of selected.dataPoints) {
      if (!byDate.has(dp.date)) {
        byDate.set(dp.date, { date: dp.date })
      }
      const row = byDate.get(dp.date)!
      row[dp.vendor] = dp.avgUnitPrice
    }

    const rows = Array.from(byDate.values()).sort((a, b) =>
      (a.date as string).localeCompare(b.date as string)
    )

    return { vendors: vendorList, chartData: rows }
  }, [selected])

  const priceChangePct = selected?.priceChangePercent ?? null

  if (data.length === 0) {
    return (
      <section className="inv-panel">
        <div className="inv-panel__head">
          <span className="inv-panel__dept">§ Vendor price trends</span>
        </div>
        <p
          className="text-[13px] text-center py-8"
          style={{ color: "var(--ink-muted)" }}
        >
          No vendor price data available.
        </p>
      </section>
    )
  }

  return (
    <section className="inv-panel">
      <div className="inv-panel__head flex-col sm:flex-row sm:items-baseline gap-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <div>
            <span className="inv-panel__dept">§ Vendors</span>
            <p
              className="font-display italic text-[18px] mt-0.5"
              style={{ color: "var(--ink)" }}
            >
              Vendor price trends{" "}
              <span style={{ color: "var(--ink-faint)" }}>· unit price history</span>
            </p>
          </div>
          {priceChangePct !== null && (
            <span
              className={`inv-stamp ${NUM_CLASS}`}
              data-tone={
                priceChangePct > 5
                  ? "alert"
                  : priceChangePct > 0
                    ? "watch"
                    : priceChangePct < 0
                      ? "info"
                      : "muted"
              }
            >
              {priceChangePct > 0 ? "+" : ""}
              {priceChangePct.toFixed(1)}% vs 30d
            </span>
          )}
        </div>
        <Select value={selectedProduct} onValueChange={setSelectedProduct}>
          <SelectTrigger className="h-8 w-50 text-[12px]">
            <SelectValue placeholder="Select ingredient" />
          </SelectTrigger>
          <SelectContent>
            {data.map((item) => (
              <SelectItem key={item.productName} value={item.productName}>
                {item.productName}
                {item.unit ? ` (${item.unit})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {chartData.length > 0 ? (
        <div className="chart-reveal">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart
            accessibilityLayer
            data={chartData}
            margin={{ left: 12, right: 12, top: 8 }}
          >
            <CartesianGrid
              strokeDasharray="2 4"
              vertical={false}
              stroke="var(--chart-grid)"
            />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={12}
              tickFormatter={formatDate}
              tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v) => formatCurrency(v)}
              width={70}
              tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            />
            <RechartsTooltip
              cursor={{ stroke: "var(--hairline-bold)", strokeDasharray: "2 4" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                return (
                  <EditorialChartTooltip
                    active
                    caption={typeof label === "string" ? formatDate(label) : ""}
                    rows={payload.map((p, i) => ({
                      label: String(p.dataKey ?? ""),
                      value: formatCurrency(Number(p.value)),
                      tone: i === 0 ? "ink" : i === 1 ? "accent" : "muted",
                    }))}
                  />
                )
              }}
            />
            {vendors.map((vendor, i) => (
              <Line
                key={vendor}
                dataKey={vendor}
                type="monotone"
                stroke={VENDOR_STROKES[i % VENDOR_STROKES.length]}
                strokeWidth={i === 0 ? 1.75 : 1.25}
                strokeDasharray={i === 0 ? undefined : i === 1 ? "5 3" : "2 3"}
                dot={chartData.length < 30}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-[13px] text-center py-8" style={{ color: "var(--ink-muted)" }}>
          No price history for this product.
        </p>
      )}
    </section>
  )
}
