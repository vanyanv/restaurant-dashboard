"use client"

import {
  Bar,
  BarChart,
  Pie,
  PieChart,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "@/components/charts/recharts"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatCurrency } from "@/lib/format"

const CATEGORY_COLORS = [
  "var(--chart-ink)",
  "var(--chart-accent)",
  "var(--chart-muted)",
  "var(--chart-subtract)",
  "var(--platform-grubhub)",
  "rgba(26, 22, 19, 0.42)",
  "rgba(220, 38, 38, 0.42)",
  "rgba(138, 58, 58, 0.36)",
]

interface CategoryDatum {
  name: string
  value: number
  fill: string
  percent: number
}

interface VendorDatum {
  name: string
  fullName: string
  spend: number
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ value: number; name: string; payload: { name: string } }>
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="border border-[var(--hairline-bold)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)]">
      <p className="font-medium">{payload[0].payload.name}</p>
      <p className="text-[var(--ink-muted)]">
        {formatCurrency(payload[0].value)}
      </p>
    </div>
  )
}

export function InvoicesCharts({
  categoryData,
  vendorData,
}: {
  categoryData: CategoryDatum[]
  vendorData: VendorDatum[]
}) {
  if (categoryData.length === 0 && vendorData.length === 0) return null

  return (
    <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
      {categoryData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Spend by Category</CardTitle>
            <CardDescription>Where your money goes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={85}
                    strokeWidth={2}
                    stroke="var(--paper)"
                  >
                    {categoryData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Pie>
                  <RechartsTooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm">
              {categoryData.map((entry) => (
                <div key={entry.name} className="flex items-center gap-2">
                  <div
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: entry.fill }}
                  />
                  <span className="max-w-[90px] truncate text-[var(--ink-muted)]">
                    {entry.name}
                  </span>
                  <span className="font-medium tabular-nums">
                    {entry.percent.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      {vendorData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Spend by Vendor</CardTitle>
            <CardDescription>Top suppliers by total spend</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer
              width="100%"
              height={vendorData.length * 44 + 20}
            >
              <BarChart
                data={vendorData}
                layout="vertical"
                margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
              >
                <CartesianGrid
                  horizontal={false}
                  strokeDasharray="3 3"
                  opacity={0.3}
                  stroke="var(--chart-grid)"
                />
                <XAxis
                  type="number"
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`}
                  fontSize={12}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={130}
                  fontSize={12}
                  tick={{ fill: "var(--ink-muted)" }}
                />
                <RechartsTooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <div className="border border-[var(--hairline-bold)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)]">
                        <p className="font-medium">
                          {payload[0].payload.fullName}
                        </p>
                        <p className="text-[var(--ink-muted)]">
                          {formatCurrency(payload[0].value as number)}
                        </p>
                      </div>
                    )
                  }}
                />
                <Bar
                  dataKey="spend"
                  fill="var(--chart-ink)"
                  radius={[0, 0, 0, 0]}
                  barSize={24}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
