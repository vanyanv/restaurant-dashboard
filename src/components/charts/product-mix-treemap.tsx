"use client"

import { useMemo } from "react"
import { Treemap, ResponsiveContainer, Tooltip } from "@/components/charts/recharts"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { formatCurrency, formatCompact } from "@/lib/format"
import type { TreemapData } from "@/types/analytics"

interface ProductMixTreemapProps {
  data: TreemapData
  className?: string
}

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--primary) / 0.6)",
]

function truncateText(text: string, maxWidth: number, fontSize: number): string {
  const avgCharWidth = fontSize * 0.6
  const maxChars = Math.floor(maxWidth / avgCharWidth)
  if (text.length <= maxChars) return text
  return maxChars > 3 ? text.slice(0, maxChars - 1) + "\u2026" : text.slice(0, maxChars)
}

interface CustomContentProps {
  x?: number
  y?: number
  width?: number
  height?: number
  name?: string
  depth?: number
  value?: number
  index?: number
  categoryColorMap: Record<string, string>
  // Recharts passes the root and additional props
  root?: { children?: { name: string }[] }
  [key: string]: unknown
}

function CustomTreemapContent(props: CustomContentProps) {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    name = "",
    depth = 0,
    value = 0,
    categoryColorMap,
  } = props

  if (width <= 0 || height <= 0) return null

  if (depth === 1) {
    // Category level
    const color = categoryColorMap[name] || COLORS[0]
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={color}
          opacity={0.85}
          stroke="#fff"
          strokeWidth={2}
        />
        {width > 80 && height > 30 && (
          <text
            x={x + width / 2}
            y={y + height / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#fff"
            fontSize={13}
            fontWeight={600}
          >
            {truncateText(name, width - 16, 13)}
          </text>
        )}
      </g>
    )
  }

  if (depth === 2) {
    // Item level - find parent category color
    const category = (props as Record<string, unknown>).category as string | undefined
    // Recharts nests item data under root; try to resolve category from props
    const parentName = category || ""
    const baseColor = categoryColorMap[parentName] || COLORS[0]
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={baseColor}
          opacity={0.7}
          stroke="#fff"
          strokeWidth={1}
        />
        {width > 60 && height > 25 && (
          <text
            x={x + width / 2}
            y={height > 45 ? y + height / 2 - 8 : y + height / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#fff"
            fontSize={11}
            fontWeight={500}
          >
            {truncateText(name, width - 12, 11)}
          </text>
        )}
        {width > 60 && height > 45 && value > 0 && (
          <text
            x={x + width / 2}
            y={y + height / 2 + 10}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#fff"
            fontSize={10}
            opacity={0.9}
          >
            {formatCompact(value)}
          </text>
        )}
      </g>
    )
  }

  return null
}

interface TooltipPayloadEntry {
  payload?: {
    name?: string
    value?: number
    category?: string
    quantity?: number
    avgPrice?: number
    depth?: number
    children?: unknown[]
  }
}

function CustomTooltipContent({
  active,
  payload,
}: {
  active?: boolean
  payload?: TooltipPayloadEntry[]
}) {
  if (!active || !payload || payload.length === 0) return null

  const data = payload[0]?.payload
  if (!data || !data.name) return null

  const isCategory = !!data.children
  const revenue = data.value ?? 0

  return (
    <div className="bg-background border rounded-lg shadow-md p-3 text-sm">
      <p className="font-semibold mb-1">{data.name}</p>
      <p className="text-muted-foreground">
        Revenue: {formatCurrency(revenue)}
      </p>
      {!isCategory && data.category && (
        <>
          <p className="text-muted-foreground">Category: {data.category}</p>
          {data.quantity != null && (
            <p className="text-muted-foreground">
              Quantity: {data.quantity}
            </p>
          )}
          {data.avgPrice != null && (
            <p className="text-muted-foreground">
              Avg Price: {formatCurrency(data.avgPrice)}
            </p>
          )}
        </>
      )}
    </div>
  )
}

export function ProductMixTreemap({ data, className }: ProductMixTreemapProps) {
  const categoryColorMap = useMemo(() => {
    const map: Record<string, string> = {}
    data.children.forEach((cat, i) => {
      map[cat.name] = COLORS[i % COLORS.length]
    })
    return map
  }, [data.children])

  const legendItems = useMemo(() => {
    return data.children.map((cat) => ({
      name: cat.name,
      color: categoryColorMap[cat.name] || COLORS[0],
    }))
  }, [data.children, categoryColorMap])

  const totalValue = useMemo(() => {
    return data.children.reduce((sum, cat) => {
      const catSum = cat.children.reduce((s, item) => s + item.value, 0)
      return sum + catSum
    }, 0)
  }, [data.children])

  if (totalValue === 0) return null

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle className="text-base">Revenue Distribution</CardTitle>
        <CardDescription>
          Category and item revenue proportions
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[350px] md:h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={data.children}
              dataKey="value"
              isAnimationActive={false}
              content={<CustomTreemapContent categoryColorMap={categoryColorMap} />}
            >
              <Tooltip content={<CustomTooltipContent />} />
            </Treemap>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm">
          {legendItems.map((item) => (
            <div key={item.name} className="flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-muted-foreground">{item.name}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
