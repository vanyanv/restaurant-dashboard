"use client"

import { useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  DateRangePicker,
  type DrawerPreset,
  type PresetOption,
} from "@/components/analytics/date-range-picker"
import type { InvoicePeriodKey } from "./sections/data"

interface InvoicesPeriodSelectorProps {
  period: InvoicePeriodKey
  startDate: string
  endDate: string
  label: string
}

const INVOICE_PRESETS: readonly PresetOption[] = [
  { label: "7 days", value: "week" },
  { label: "30 days", value: "month" },
  { label: "90 days", value: "3months" },
  { label: "12 months", value: "year" },
]

const rollingWindow = (days: number) => (today: Date): [Date, Date] => {
  const start = new Date(today)
  start.setDate(start.getDate() - (days - 1))
  return [start, today]
}

const lastTwelveMonths = (today: Date): [Date, Date] => {
  const start = new Date(today)
  start.setFullYear(start.getFullYear() - 1)
  start.setDate(start.getDate() + 1)
  return [start, today]
}

const INVOICE_DRAWER_PRESETS: DrawerPreset[] = [
  { group: "Invoice ranges", label: "Last 7 days", compute: rollingWindow(7) },
  { group: "Invoice ranges", label: "Last 30 days", compute: rollingWindow(30) },
  { group: "Invoice ranges", label: "Last 90 days", compute: rollingWindow(90) },
  { group: "Invoice ranges", label: "Last 12 months", compute: lastTwelveMonths },
]

export function InvoicesPeriodSelector({
  period,
  startDate,
  endDate,
  label,
}: InvoicesPeriodSelectorProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const pushFilters = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "")
    params.delete("page")
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "" || v === "all") params.delete(k)
      else params.set(k, v)
    }
    const qs = params.toString()
    startTransition(() => {
      router.replace(
        qs ? `/dashboard/invoices?${qs}` : "/dashboard/invoices",
        { scroll: false }
      )
    })
  }

  const handlePresetClick = (value: string) => {
    pushFilters({
      period: value === "month" ? null : value,
      startDate: null,
      endDate: null,
    })
  }

  const handleRangeChange = (start: string, end: string) => {
    pushFilters({
      period: "custom",
      startDate: start,
      endDate: end,
    })
  }

  return (
    <section
      className="inv-panel flex flex-wrap items-center justify-between gap-3 px-4 py-3"
      aria-label="Invoice period"
      data-pending={isPending || undefined}
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-(--ink-faint)">
          Invoice range
        </span>
        <span className="text-sm italic text-(--ink-muted)">{label}</span>
      </div>

      <DateRangePicker
        days={30}
        customRange={{ startDate, endDate }}
        onRangeChange={handleRangeChange}
        isPending={isPending}
        presets={INVOICE_PRESETS}
        drawerPresets={INVOICE_DRAWER_PRESETS}
        activePresetValue={period === "custom" ? undefined : period}
        onPresetClick={handlePresetClick}
      />
    </section>
  )
}
