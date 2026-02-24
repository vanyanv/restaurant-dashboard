"use client"

import { useState, useTransition, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  DollarSign,
  FileText,
  AlertCircle,
  Building2,
  SidebarIcon,
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
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { InvoiceSyncButton } from "@/components/invoice-sync-button"
import { getInvoiceSummary, getInvoiceList, getProductAnalytics } from "@/app/actions/invoice-actions"
import type { InvoiceKpis, InvoiceListItem, ProductAnalytics } from "@/types/invoice"
import { formatCurrency } from "@/lib/format"

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

function getLastSyncText(lastSyncAt: string | null): string {
  if (!lastSyncAt) return "Never synced"
  const date = new Date(lastSyncAt)
  const diffHours = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60))
  if (diffHours < 1) return "Synced recently"
  if (diffHours < 24) return `Synced ${diffHours}h ago`
  if (diffHours < 168) return `Synced ${Math.floor(diffHours / 24)}d ago`
  return "Synced over a week ago"
}

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
      color: "border-l-blue-500",
    },
    {
      title: "Invoices",
      value: summary.invoiceCount.toString(),
      icon: FileText,
      color: "border-l-emerald-500",
    },
    {
      title: "Avg Invoice",
      value: formatCurrency(summary.avgInvoiceTotal),
      icon: TrendingUp,
      color: "border-l-violet-500",
    },
    {
      title: "Needs Review",
      value: summary.pendingReviewCount.toString(),
      icon: AlertCircle,
      color: "border-l-amber-500",
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
    <>
      {/* Header */}
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1">
          <SidebarIcon className="h-4 w-4" />
        </SidebarTrigger>
        <Separator orientation="vertical" className="mr-2 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Invoices</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="ml-auto flex items-center gap-3">
          {/* Store Filter */}
          {stores.length > 0 && (
            <Select value={storeFilter} onValueChange={handleStoreFilter}>
              <SelectTrigger className="w-[180px]">
                <Building2 className="h-4 w-4 mr-2 shrink-0 text-muted-foreground" />
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

          {/* Last Sync + Sync Button */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {getLastSyncText(lastSyncAt)}
            </span>
            <InvoiceSyncButton lastSyncAt={lastSyncAt} size="default" onSyncComplete={refreshData} />
          </div>
        </div>
      </header>

      <div className={`flex-1 overflow-auto p-4 space-y-6 ${isPending ? "opacity-60 pointer-events-none" : ""}`}>
        {/* KPI Cards */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {kpiCards.map((kpi, i) => (
            <motion.div
              key={kpi.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className={`border-l-4 ${kpi.color}`}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {kpi.title}
                  </CardTitle>
                  <kpi.icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{kpi.value}</div>
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
    </>
  )
}
