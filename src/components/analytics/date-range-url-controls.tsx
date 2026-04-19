"use client"

import { useCallback, useTransition } from "react"
import { useRouter } from "next/navigation"
import { DateRangePicker } from "./date-range-picker"
import { localDateStr, type DashboardRange } from "@/lib/dashboard-utils"

const PRESETS = new Set([1, -1, 3, 7, 14, 30, 90])

interface DateRangeUrlControlsProps {
  range: DashboardRange
  basePath: string
}

export function DateRangeUrlControls({
  range,
  basePath,
}: DateRangeUrlControlsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const days = range.kind === "days" ? range.days : 0
  const customRange =
    range.kind === "custom"
      ? { startDate: range.startDate, endDate: range.endDate }
      : null

  const handleRangeChange = useCallback(
    (startDate: string, endDate: string) => {
      const diffDays = Math.round(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) /
          (1000 * 60 * 60 * 24)
      )

      let presetDays: number
      if (diffDays === 0) {
        const today = localDateStr(new Date())
        if (startDate === today) {
          presetDays = 1
        } else {
          const yday = new Date()
          yday.setDate(yday.getDate() - 1)
          presetDays = startDate === localDateStr(yday) ? -1 : diffDays
        }
      } else {
        presetDays = diffDays
      }

      const params = new URLSearchParams()
      if (PRESETS.has(presetDays)) {
        params.set("days", String(presetDays))
      } else {
        params.set("start", startDate)
        params.set("end", endDate)
      }

      startTransition(() => {
        router.replace(`${basePath}?${params.toString()}`, { scroll: false })
      })
    },
    [router, basePath]
  )

  return (
    <DateRangePicker
      days={days}
      customRange={customRange}
      onRangeChange={handleRangeChange}
      isPending={isPending}
    />
  )
}
