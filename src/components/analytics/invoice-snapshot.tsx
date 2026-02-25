"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/format"
import type { InvoiceKpis, InvoiceListItem } from "@/types/invoice"

const STATUS_STYLES: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  MATCHED: { label: "Matched", variant: "default" },
  APPROVED: { label: "Approved", variant: "default" },
  REVIEW: { label: "Review", variant: "secondary" },
  PENDING: { label: "Pending", variant: "outline" },
  REJECTED: { label: "Rejected", variant: "destructive" },
}

const KPI_CARDS = [
  {
    key: "totalSpend",
    label: "Total Spend",
    color: "hsl(221, 83%, 53%)",
    bgTint: "hsla(221, 83%, 53%, 0.04)",
    getValue: (s: InvoiceKpis) => formatCurrency(s.totalSpend),
  },
  {
    key: "invoiceCount",
    label: "Invoices",
    color: "hsl(142, 71%, 45%)",
    bgTint: "hsla(142, 71%, 45%, 0.04)",
    getValue: (s: InvoiceKpis) => s.invoiceCount.toString(),
  },
  {
    key: "needsReview",
    label: "Needs Review",
    color: "hsl(35, 85%, 45%)",
    bgTint: "hsla(35, 85%, 45%, 0.04)",
    getValue: (s: InvoiceKpis) => s.pendingReviewCount.toString(),
    highlight: (s: InvoiceKpis) => s.pendingReviewCount > 0,
  },
]

interface InvoiceSnapshotProps {
  summary: InvoiceKpis
  recentInvoices: InvoiceListItem[]
}

export function InvoiceSnapshot({ summary, recentInvoices }: InvoiceSnapshotProps) {
  return (
    <div className="space-y-1.5">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-foreground">Invoice Snapshot</h3>
          <span className="text-[11px] text-muted-foreground">Last 30 days</span>
        </div>
        <Link
          href="/dashboard/invoices"
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          View All
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* KPI mini-cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {KPI_CARDS.map((kpi, i) => (
          <motion.div
            key={kpi.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.35, ease: "easeOut" }}
          >
            <Card
              className="relative overflow-hidden border-t-[3px] py-2"
              style={{ borderTopColor: kpi.color, backgroundColor: kpi.bgTint }}
            >
              <CardContent className="p-2.5 sm:p-3">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {kpi.label}
                </span>
                <div
                  className="mt-0.5 font-mono-numbers text-lg font-bold tracking-tight sm:text-xl"
                  style={kpi.highlight?.(summary) ? { color: "hsl(0, 72%, 51%)" } : undefined}
                >
                  {kpi.getValue(summary)}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Recent invoices list */}
      {recentInvoices.length > 0 && (
        <Card className="mt-2 overflow-hidden">
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {recentInvoices.slice(0, 5).map((inv) => {
                const statusStyle = STATUS_STYLES[inv.status] ?? STATUS_STYLES.PENDING
                return (
                  <Link
                    key={inv.id}
                    href={`/dashboard/invoices/${inv.id}`}
                    className="flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium truncate max-w-[140px] sm:max-w-[200px]">
                        {inv.vendorName}
                      </span>
                      <span className="text-xs text-muted-foreground hidden sm:inline">
                        {inv.invoiceDate ?? "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={statusStyle.variant} className="text-xs">
                        {statusStyle.label}
                      </Badge>
                      <span className="font-mono-numbers text-sm font-medium">
                        {formatCurrency(inv.totalAmount)}
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
