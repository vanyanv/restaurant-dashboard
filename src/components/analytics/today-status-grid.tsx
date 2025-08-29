"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, XCircle, Clock } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

interface TodayStatusGridProps {
  data: Array<{
    storeId: string
    storeName: string
    morning: {
      submitted: boolean
      manager: string | null
    }
    evening: {
      submitted: boolean
      manager: string | null
    }
  }>
  className?: string
}

export function TodayStatusGrid({ data, className }: TodayStatusGridProps) {
  const getStatusBadge = (submitted: boolean, manager: string | null, shift: string) => {
    if (submitted) {
      return (
        <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
          <CheckCircle className="h-3 w-3 mr-1" />
          {manager}
        </Badge>
      )
    }

    // Check if it's still reasonable time for submission
    const now = new Date()
    const currentHour = now.getHours()
    const isPastDeadline = shift === 'Morning' 
      ? currentHour > 12  // Past noon
      : currentHour > 22  // Past 10 PM

    return (
      <Badge variant="outline" className={cn(
        "text-orange-600 border-orange-200 bg-orange-50",
        isPastDeadline && "text-red-600 border-red-200 bg-red-50"
      )}>
        {isPastDeadline ? (
          <XCircle className="h-3 w-3 mr-1" />
        ) : (
          <Clock className="h-3 w-3 mr-1" />
        )}
        {isPastDeadline ? 'Missing' : 'Pending'}
      </Badge>
    )
  }

  const getCompletionStats = () => {
    const totalShifts = data.length * 2 // Each store has morning and evening
    const submittedShifts = data.reduce((acc, store) => {
      return acc + (store.morning.submitted ? 1 : 0) + (store.evening.submitted ? 1 : 0)
    }, 0)
    
    return {
      completed: submittedShifts,
      total: totalShifts,
      percentage: totalShifts > 0 ? Math.round((submittedShifts / totalShifts) * 100) : 0
    }
  }

  const stats = getCompletionStats()

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Today's Report Status</CardTitle>
            <CardDescription>
              Report submission status for all stores today
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{stats.percentage}%</div>
            <div className="text-sm text-muted-foreground">
              {stats.completed}/{stats.total} submitted
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2" />
            <p>No stores available</p>
          </div>
        ) : (
          <div className="space-y-4">
            {data.map((store) => (
              <div 
                key={store.storeId} 
                className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <Link 
                    href={`/dashboard/store/${store.storeId}`}
                    className="font-medium hover:underline"
                  >
                    {store.storeName}
                  </Link>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={cn(
                      "w-2 h-2 rounded-full",
                      store.morning.submitted && store.evening.submitted 
                        ? "bg-green-500"
                        : store.morning.submitted || store.evening.submitted
                        ? "bg-orange-500" 
                        : "bg-red-500"
                    )} />
                    {store.morning.submitted && store.evening.submitted ? "Complete" :
                     store.morning.submitted || store.evening.submitted ? "Partial" : "Missing"}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      Morning Shift
                    </div>
                    {getStatusBadge(store.morning.submitted, store.morning.manager, 'Morning')}
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      Evening Shift
                    </div>
                    {getStatusBadge(store.evening.submitted, store.evening.manager, 'Evening')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}