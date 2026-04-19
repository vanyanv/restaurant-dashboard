"use client"

import { useState, useTransition, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  DollarSign,
  FileText,
  AlertCircle,
  Building2,
  Package,
  TrendingUp,
  ChevronDown,
} from "lucide-react"
import { motion } from "framer-motion"
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
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { InvoiceSyncButton } from "@/components/invoice-sync-button"
import { getInvoiceSummary, getInvoiceList, getProductAnalytics } from "@/app/actions/invoice-actions"
import type { InvoiceKpis, InvoiceListItem, ProductAnalytics } from "@/types/invoice"
import { formatCurrency } from "@/lib/format"
import { getLastSyncText } from "@/lib/dashboard-utils"

interface InvoicesContentProps {
  initialSummary: InvoiceKpis
  initialInvoices: {
    invoices: InvoiceListItem[]
    total: number
    page: number
    totalPages: number
  }
  initialProducts: ProductAnalytics
  lastSyncAt: string | null
  stores: Array<{ id: string; name: string }>
}

const STATUS_STYLES: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  MATCHED: { label: "Matched", variant: "default" },
  APPROVED: { label: "Approved", variant: "default" },
  REVIEW: { label: "Review", variant: "secondary" },
  PENDING: { label: "Pending", variant: "outline" },
  REJECTED: { label: "Rejected", variant: "destructive" },
}

const CATEGORY_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--primary) / 0.6)",
  "hsl(var(--primary) / 0.4)",
  "hsl(var(--primary) / 0.25)",
]

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ value: number; name: string; payload: { name: string } }> }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{payload[0].payload.name}</p>
      <p className="text-muted-foreground">{formatCurrency(payload[0].value)}</p>
    </div>
  )
}

export function InvoicesContent({
  initialSummary,
  initialInvoices,
  initialProducts,
  lastSyncAt,
  stores,
}: InvoicesContentProps) {
  const router = useRouter()
  const [summary, setSummary] = useState(initialSummary)
  const [invoiceData, setInvoiceData] = useState(initialInvoices)
  const [products, setProducts] = useState(initialProducts)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [storeFilter, setStoreFilter] = useState<string>("all")
  const [isPending, startTransition] = useTransition()

  const prefetchedRef = useRef<Set<string>>(new Set())
  const prefetchInvoice = useCallback(
    (id: string) => {
      if (prefetchedRef.current.has(id)) return
      if (typeof navigator !== "undefined") {
        const conn = (navigator as Navigator & {
          connection?: { saveData?: boolean; effectiveType?: string }
        }).connection
        if (conn?.saveData) return
        if (conn?.effectiveType === "slow-2g" || conn?.effectiveType === "2g") return
      }
      prefetchedRef.current.add(id)
      router.prefetch(`/dashboard/invoices/${id}`)
      fetch(`/api/invoices/${id}/pdf`, { credentials: "same-origin" }).catch(
        () => {
          prefetchedRef.current.delete(id)
        },
      )
    },
    [router],
  )

  const refreshData = useCallback(
    (opts?: { status?: string; storeId?: string }) => {
      startTransition(async () => {
        const filterStatus = (opts?.status ?? statusFilter) === "all" ? undefined : (opts?.status ?? statusFilter)
        const filterStore = (opts?.storeId ?? storeFilter) === "all" ? undefined : (opts?.storeId ?? storeFilter)
        const [newSummary, newInvoices, newProducts] = await Promise.all([
          getInvoiceSummary({ storeId: filterStore }),
          getInvoiceList({ status: filterStatus, storeId: filterStore }),
          getProductAnalytics({ storeId: filterStore }),
        ])
        setSummary(newSummary)
        setInvoiceData(newInvoices)
        setProducts(newProducts)
      })
    },
    [statusFilter, storeFilter]
  )

  const handleStatusFilter = (value: string) => {
    setStatusFilter(value)
    refreshData({ status: value })
  }

  const handleStoreFilter = (value: string) => {
    setStoreFilter(value)
    refreshData({ storeId: value })
  }

  const kpiCards = [
    {
      title: "Total Spend",
      value: formatCurrency(summary.totalSpend),
      icon: DollarSign,
      borderColor: "hsl(221, 83%, 53%)",
      bgTint: "hsla(221, 83%, 53%, 0.04)",
    },
    {
      title: "Invoices",
      value: summary.invoiceCount.toString(),
      icon: FileText,
      borderColor: "hsl(142, 71%, 45%)",
      bgTint: "hsla(142, 71%, 45%, 0.04)",
    },
    {
      title: "Avg Invoice",
      value: formatCurrency(summary.avgInvoiceTotal),
      icon: TrendingUp,
      borderColor: "hsl(262, 83%, 58%)",
      bgTint: "hsla(262, 83%, 58%, 0.04)",
    },
    {
      title: "Needs Review",
      value: summary.pendingReviewCount.toString(),
      icon: AlertCircle,
      borderColor: "hsl(35, 85%, 45%)",
      bgTint: "hsla(35, 85%, 45%, 0.04)",
    },
  ]

  // Prepare chart data
  const categoryChartData = summary.spendByCategory.slice(0, 8).map((c, i) => ({
    name: c.category,
    value: c.total,
    fill: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    percent: summary.totalSpend > 0 ? ((c.total / summary.totalSpend) * 100) : 0,
  }))

  const vendorChartData = summary.spendByVendor.slice(0, 6).map((v) => ({
    name: v.vendor.length > 20 ? v.vendor.slice(0, 20) + "..." : v.vendor,
    fullName: v.vendor,
    spend: v.total,
  }))

  const maxProductSpend = products.topProducts[0]?.totalSpend ?? 1

  return (
    <div className="flex flex-col h-full">
      {/* Sticky Header */}
      <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="px-3 sm:px-4 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <h1 className="text-lg font-semibold tracking-tight">Invoices</h1>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block w-1 h-1 rounded-full bg-muted-foreground/50" />
              <span suppressHydrationWarning>{getLastSyncText(lastSyncAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {stores.length > 0 && (
              <Select value={storeFilter} onValueChange={handleStoreFilter}>
                <SelectTrigger className="w-[160px] h-8 text-xs">
                  <Building2 className="h-3.5 w-3.5 mr-1.5 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder="All Stores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stores</SelectItem>
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <InvoiceSyncButton lastSyncAt={lastSyncAt} size="sm" variant="outline" />
          </div>
        </div>
        {/* Mobile sync info */}
        <div className="sm:hidden px-3 pb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span suppressHydrationWarning>{getLastSyncText(lastSyncAt)}</span>
        </div>
      </div>

      <div className={`flex-1 overflow-auto p-3 sm:p-4 space-y-3 ${isPending ? "opacity-60 pointer-events-none" : ""}`}>
        {/* KPI Cards */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {kpiCards.map((kpi, i) => (
            <motion.div
              key={kpi.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.35, ease: "easeOut" }}
            >
              <Card
                className="relative overflow-hidden border-t-[3px] py-3"
                style={{ borderTopColor: kpi.borderColor, backgroundColor: kpi.bgTint }}
              >
                <CardContent className="p-3">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {kpi.title}
                  </span>
                  <div className="mt-1 font-mono-numbers text-xl font-bold tracking-tight sm:text-2xl">
                    {kpi.value}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Charts Row */}
        {(categoryChartData.length > 0 || vendorChartData.length > 0) && (
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
            {/* Category Donut */}
            {categoryChartData.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
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
                            data={categoryChartData}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={55}
                            outerRadius={85}
                            strokeWidth={2}
                            stroke="hsl(var(--background))"
                          >
                            {categoryChartData.map((entry, idx) => (
                              <Cell key={idx} fill={entry.fill} />
                            ))}
                          </Pie>
                          <RechartsTooltip content={<CustomTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm">
                      {categoryChartData.map((entry) => (
                        <div key={entry.name} className="flex items-center gap-2">
                          <div
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: entry.fill }}
                          />
                          <span className="text-muted-foreground truncate max-w-[90px]">{entry.name}</span>
                          <span className="font-medium tabular-nums">{entry.percent.toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* Vendor Bar Chart */}
            {vendorChartData.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Spend by Vendor</CardTitle>
                    <CardDescription>Top suppliers by total spend</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={vendorChartData.length * 44 + 20}>
                      <BarChart
                        data={vendorChartData}
                        layout="vertical"
                        margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
                      >
                        <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                        <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} fontSize={12} />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={130}
                          fontSize={12}
                          tick={{ fill: "hsl(var(--muted-foreground))" }}
                        />
                        <RechartsTooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null
                            return (
                              <div className="rounded-lg border bg-background px-3 py-2 text-sm shadow-md">
                                <p className="font-medium">{payload[0].payload.fullName}</p>
                                <p className="text-muted-foreground">{formatCurrency(payload[0].value as number)}</p>
                              </div>
                            )
                          }}
                        />
                        <Bar
                          dataKey="spend"
                          fill="hsl(var(--chart-1))"
                          radius={[0, 4, 4, 0]}
                          barSize={24}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </div>
        )}

        {/* Top Products */}
        {products.topProducts.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Collapsible defaultOpen={false}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer select-none hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Package className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <CardTitle className="text-base">Top Products</CardTitle>
                          <CardDescription>Most ordered items by total spend (last 90 days)</CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {products.topProducts.length} items
                        </Badge>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 in-data-[state=open]:rotate-180" />
                      </div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10">#</TableHead>
                            <TableHead>Product</TableHead>
                            <TableHead>SKU</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Avg Price</TableHead>
                            <TableHead className="text-right">Total Spend</TableHead>
                            <TableHead className="w-[120px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {products.topProducts.map((p, i) => {
                            const pct = (p.totalSpend / maxProductSpend) * 100
                            return (
                              <TableRow key={`${p.productName}-${i}`}>
                                <TableCell className="font-mono text-muted-foreground text-xs">
                                  {i + 1}
                                </TableCell>
                                <TableCell className="font-medium max-w-[250px]">
                                  <span className="truncate block">{p.productName}</span>
                                </TableCell>
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                  {p.sku ?? "—"}
                                </TableCell>
                                <TableCell>
                                  {p.category ? (
                                    <Badge variant="outline" className="text-xs font-normal">
                                      {p.category}
                                    </Badge>
                                  ) : "—"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {p.totalQuantity.toFixed(0)}
                                  {p.unit ? <span className="text-muted-foreground text-xs ml-1">{p.unit}</span> : ""}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(p.avgUnitPrice)}
                                </TableCell>
                                <TableCell className="text-right font-medium tabular-nums">
                                  {formatCurrency(p.totalSpend)}
                                </TableCell>
                                <TableCell>
                                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-primary/25 rounded-full transition-all"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </motion.div>
        )}

        {/* Invoice Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Invoices</CardTitle>
            <Select value={statusFilter} onValueChange={handleStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="MATCHED">Matched</SelectItem>
                <SelectItem value="REVIEW">Needs Review</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {invoiceData.invoices.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">No invoices yet</p>
                <p className="text-sm mt-1">Click &quot;Sync Invoices&quot; to fetch from email</p>
              </div>
            ) : (
              <>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Store</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Items</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoiceData.invoices.map((inv) => {
                        const statusStyle = STATUS_STYLES[inv.status] ?? STATUS_STYLES.PENDING
                        return (
                          <TableRow
                            key={inv.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => router.push(`/dashboard/invoices/${inv.id}`)}
                            onMouseEnter={() => prefetchInvoice(inv.id)}
                            onFocus={() => prefetchInvoice(inv.id)}
                            onTouchStart={() => prefetchInvoice(inv.id)}
                          >
                            <TableCell className="font-medium max-w-[200px] truncate">
                              {inv.vendorName}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {inv.invoiceNumber}
                            </TableCell>
                            <TableCell>{inv.invoiceDate ?? "—"}</TableCell>
                            <TableCell>{inv.storeName ?? "Unmatched"}</TableCell>
                            <TableCell className="text-right font-medium">
                              {formatCurrency(inv.totalAmount)}
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusStyle.variant}>
                                {statusStyle.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {inv.lineItemCount}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {invoiceData.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Showing {invoiceData.invoices.length} of {invoiceData.total} invoices
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={invoiceData.page <= 1}
                        onClick={() => {
                          startTransition(async () => {
                            const filterStore = storeFilter === "all" ? undefined : storeFilter
                            const result = await getInvoiceList({
                              status: statusFilter === "all" ? undefined : statusFilter,
                              storeId: filterStore,
                              page: invoiceData.page - 1,
                            })
                            setInvoiceData(result)
                          })
                        }}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={invoiceData.page >= invoiceData.totalPages}
                        onClick={() => {
                          startTransition(async () => {
                            const filterStore = storeFilter === "all" ? undefined : storeFilter
                            const result = await getInvoiceList({
                              status: statusFilter === "all" ? undefined : statusFilter,
                              storeId: filterStore,
                              page: invoiceData.page + 1,
                            })
                            setInvoiceData(result)
                          })
                        }}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
