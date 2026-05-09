"use client"

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
        <Badge variant="outline" className="rounded-xs border-(--hairline-bold) bg-(--accent-bg) text-(--accent-dark)">
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
        "rounded-xs border-(--hairline-bold) bg-(--paper-warm) text-(--ink-muted)",
        isPastDeadline && "border-(--hairline-bold) bg-(--accent-bg) text-(--accent)"
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
    <section className={cn("inv-panel", className)}>
      <header className="inv-panel__head">
        <div className="flex flex-col gap-1">
          <span className="inv-panel__dept">Today&apos;s Report Status</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
            Submission status across all stores
          </span>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums">{stats.percentage}%</div>
          <div className="text-sm text-(--ink-muted) tabular-nums">
            {stats.completed}/{stats.total} submitted
          </div>
        </div>
      </header>
      {data.length === 0 ? (
        <div className="text-center py-8 text-(--ink-muted)">
          <Clock className="h-8 w-8 mx-auto mb-2" />
          <p>No stores available</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((store) => (
            <div
              key={store.storeId}
              className="border border-(--hairline) rounded-xs p-4 transition-colors hover:bg-(--paper-warm)"
            >
              <div className="flex items-center justify-between mb-3">
                <Link
                  href={`/dashboard/store/${store.storeId}`}
                  className="font-medium hover:underline hover:text-(--accent)"
                >
                  {store.storeName}
                </Link>
                <div className="flex items-center gap-2 text-xs text-(--ink-muted)">
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    store.morning.submitted && store.evening.submitted
                      ? "bg-(--ink)"
                      : store.morning.submitted || store.evening.submitted
                      ? "bg-(--ink-muted)"
                      : "bg-(--accent)"
                  )} />
                  {store.morning.submitted && store.evening.submitted ? "Complete" :
                   store.morning.submitted || store.evening.submitted ? "Partial" : "Missing"}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint) mb-1">
                    Morning Shift
                  </div>
                  {getStatusBadge(store.morning.submitted, store.morning.manager, 'Morning')}
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint) mb-1">
                    Evening Shift
                  </div>
                  {getStatusBadge(store.evening.submitted, store.evening.manager, 'Evening')}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}