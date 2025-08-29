"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
        return <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50">🌅 Morning</Badge>
      case 'EVENING':
        return <Badge variant="outline" className="text-purple-600 border-purple-200 bg-purple-50">🌆 Evening</Badge>
      case 'BOTH':
        return <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">🌅🌆 Both</Badge>
      default:
        return <Badge variant="outline">{shift}</Badge>
    }
  }

  const getPrepCompletionBadge = (morning: number, evening: number) => {
    const avg = (morning + evening) / 2
    if (avg >= 90) return <Badge className="bg-green-100 text-green-700 border-green-200">{Math.round(avg)}%</Badge>
    if (avg >= 70) return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">{Math.round(avg)}%</Badge>
    return <Badge className="bg-red-100 text-red-700 border-red-200">{Math.round(avg)}%</Badge>
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
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
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
                        <Store className="h-4 w-4 text-muted-foreground" />
                        {report.store.name}
                      </Link>
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{report.manager.name}</div>
                        <div className="text-xs text-muted-foreground">{report.manager.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                      <span className={cn(
                        "font-medium",
                        (report.endingAmount - report.startingAmount) > 0 
                          ? "text-green-600" 
                          : "text-red-600"
                      )}>
                        {formatCurrency(report.endingAmount - report.startingAmount)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      {report.totalSales ? formatCurrency(report.totalSales) : '—'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ChefHat className="h-4 w-4 text-muted-foreground" />
                      {getPrepCompletionBadge(report.morningPrepCompleted, report.eveningPrepCompleted)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs text-muted-foreground">
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
      </CardContent>
    </Card>
  )
}