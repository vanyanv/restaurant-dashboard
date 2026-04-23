"use client"

import { useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  DateRangePicker,
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
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
  { label: "Quarter", value: "3months" },
  { label: "Year", value: "year" },
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
          Ledger period
        </span>
        <span className="text-sm italic text-(--ink-muted)">{label}</span>
      </div>

      <DateRangePicker
        days={30}
        customRange={{ startDate, endDate }}
        onRangeChange={handleRangeChange}
        isPending={isPending}
        presets={INVOICE_PRESETS}
        activePresetValue={period === "custom" ? undefined : period}
        onPresetClick={handlePresetClick}
      />
    </section>
  )
}
