"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { 
  Eye, 
  Calendar, 
  Store, 
  User,
  TrendingUp,
  DollarSign,
  ChefHat
} from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

interface RecentReportsTableProps {
  data: Array<{
    id: string
    date: Date | string
    shift: string
    storeId: string
    store: {
      id: string
      name: string
    }
    manager: {
      name: string
      email: string
    }
    startingAmount: number
    endingAmount: number
    totalSales?: number | null
    cashTips?: number | null
    morningPrepCompleted: number
    eveningPrepCompleted: number
    createdAt: Date | string
    updatedAt: Date | string
  }>
  title?: string
  description?: string
  className?: string
  showStore?: boolean
}

export function RecentReportsTable({ 
  data,
  title = "Recent Reports",
  description = "Latest daily reports from all stores",
  className,
  showStore = true
}: RecentReportsTableProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const getShiftBadge = (shift: string) => {
    switch (shift) {
      case 'MORNING':
        return <Badge variant="outline" className="rounded-xs border-(--hairline-bold) bg-(--paper) text-(--ink-muted)">Morning</Badge>
      case 'EVENING':
        return <Badge variant="outline" className="rounded-xs border-(--hairline-bold) bg-(--paper-warm) text-(--ink)">Evening</Badge>
      case 'BOTH':
        return <Badge variant="outline" className="rounded-xs border-(--hairline-bold) bg-(--accent-bg) text-(--accent-dark)">Both</Badge>
      default:
        return <Badge variant="outline" className="rounded-xs border-(--hairline-bold) text-(--ink-muted)">{shift}</Badge>
    }
  }

  const getPrepCompletionBadge = (morning: number, evening: number) => {
    const avg = (morning + evening) / 2
    if (avg >= 90) return <Badge className="rounded-xs border border-(--hairline-bold) bg-(--accent-bg) text-(--accent-dark) tabular-nums">{Math.round(avg)}%</Badge>
    if (avg >= 70) return <Badge className="rounded-xs border border-(--hairline-bold) bg-(--paper-warm) text-(--ink-muted) tabular-nums">{Math.round(avg)}%</Badge>
    return <Badge className="rounded-xs border border-(--hairline-bold) bg-(--accent-bg) text-(--accent) tabular-nums">{Math.round(avg)}%</Badge>
  }

  const getTimeAgo = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60))
    
    if (diffInHours < 1) return 'Just now'
    if (diffInHours < 24) return `${diffInHours}h ago`
    const diffInDays = Math.floor(diffInHours / 24)
    if (diffInDays < 7) return `${diffInDays}d ago`
    return formatDate(d)
  }

  return (
    <section className={cn("inv-panel", className)}>
      <header className="inv-panel__head">
        <div className="flex flex-col gap-1">
          <span className="inv-panel__dept flex items-center gap-2">
            <Calendar className="h-3 w-3 text-(--ink-faint)" />
            {title}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
            {description}
          </span>
        </div>
      </header>
      <div>
        {data.length === 0 ? (
          <div className="text-center py-8 text-(--ink-muted)">
            <Calendar className="h-8 w-8 mx-auto mb-2" />
            <p>No recent reports found</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Report Date</TableHead>
                <TableHead>Shift</TableHead>
                {showStore && <TableHead>Store</TableHead>}
                <TableHead>Manager</TableHead>
                <TableHead>Till Variance</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>Prep</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((report) => (
                <TableRow key={report.id}>
                  <TableCell className="font-medium">
                    {formatDate(report.date)}
                  </TableCell>
                  <TableCell>
                    {getShiftBadge(report.shift)}
                  </TableCell>
                  {showStore && (
                    <TableCell>
                      <Link 
                        href={`/dashboard/store/${report.storeId}`}
                        className="flex items-center gap-2 hover:underline"
                      >
                        <Store className="h-4 w-4 text-(--ink-muted)" />
                        {report.store.name}
                      </Link>
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-(--ink-muted)" />
                      <div>
                        <div className="font-medium">{report.manager.name}</div>
                        <div className="text-xs text-(--ink-muted)">{report.manager.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-(--ink-muted)" />
                      <span className={cn(
                        "font-medium",
                        (report.endingAmount - report.startingAmount) > 0
                          ? "text-(--ink) tabular-nums"
                          : "text-(--subtract) tabular-nums"
                      )}>
                        {formatCurrency(report.endingAmount - report.startingAmount)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-(--ink-muted)" />
                      {report.totalSales ? formatCurrency(report.totalSales) : '—'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ChefHat className="h-4 w-4 text-(--ink-muted)" />
                      {getPrepCompletionBadge(report.morningPrepCompleted, report.eveningPrepCompleted)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs text-(--ink-muted)">
                      {getTimeAgo(report.createdAt)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/dashboard/reports/${report.id}`}>
                        <Eye className="h-3 w-3 mr-1" />
                        View
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  )
}