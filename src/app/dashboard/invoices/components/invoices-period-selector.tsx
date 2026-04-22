"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Calendar as CalendarIcon } from "lucide-react"
import { format } from "date-fns"
import type { DateRange } from "react-day-picker"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { InvoicePeriodKey } from "./sections/data"

interface InvoicesPeriodSelectorProps {
  period: InvoicePeriodKey
  startDate: string
  endDate: string
  label: string
}

const PERIOD_OPTIONS: Array<{
  key: InvoicePeriodKey
  label: string
  sub: string
}> = [
  { key: "week", label: "Week", sub: "7d" },
  { key: "month", label: "Month", sub: "30d" },
  { key: "3months", label: "Quarter", sub: "90d" },
  { key: "year", label: "Year", sub: "12mo" },
]

function parseLocal(s: string): Date {
  return new Date(s + "T00:00:00")
}

function toIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function InvoicesPeriodSelector({
  period,
  startDate,
  endDate,
  label,
}: InvoicesPeriodSelectorProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [popoverOpen, setPopoverOpen] = useState(false)

  const currentRange = useMemo<DateRange>(
    () => ({ from: parseLocal(startDate), to: parseLocal(endDate) }),
    [startDate, endDate]
  )

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

  const handlePeriodClick = (key: InvoicePeriodKey) => {
    pushFilters({
      period: key === "month" ? null : key,
      startDate: null,
      endDate: null,
    })
  }

  const handleCustomApply = (range: DateRange | undefined) => {
    if (!range?.from || !range?.to) return
    pushFilters({
      period: "custom",
      startDate: toIso(range.from),
      endDate: toIso(range.to),
    })
    setPopoverOpen(false)
  }

  return (
    <section
      className="inv-panel inv-period"
      aria-label="Invoice period"
      data-pending={isPending || undefined}
      style={{ opacity: isPending ? 0.7 : 1 }}
    >
      <div className="inv-period__masthead">
        <span className="inv-period__caption">Ledger period</span>
        <span className="inv-period__range">{label}</span>
      </div>

      <div
        className="inv-period__pills"
        role="radiogroup"
        aria-label="Select period"
      >
        {PERIOD_OPTIONS.map((opt) => {
          const active = period === opt.key
          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => handlePeriodClick(opt.key)}
              disabled={isPending}
              className="inv-period__pill"
              data-active={active || undefined}
            >
              <span>{opt.label}</span>
              <span className="inv-period__pill-sub">{opt.sub}</span>
            </button>
          )
        })}

        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inv-period__pill"
              data-active={period === "custom" || undefined}
              disabled={isPending}
            >
              <CalendarIcon className="h-3 w-3" />
              <span>Custom</span>
              <span className="inv-period__pill-sub">
                {period === "custom" ? "·" : "…"}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto border border-(--hairline-bold) bg-(--paper) p-0 shadow-[0_10px_30px_-12px_rgba(26,22,19,0.18)]"
            align="end"
            sideOffset={8}
          >
            <div className="border-b border-(--hairline) px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-(--ink-faint)">
                Pick a range
              </p>
              <p className="mt-1 text-sm italic text-(--ink-muted)">
                Click first day, then last day.
              </p>
            </div>
            <Calendar
              mode="range"
              selected={currentRange}
              onSelect={handleCustomApply}
              numberOfMonths={2}
              defaultMonth={currentRange.from}
            />
            <div className="flex items-center justify-between border-t border-(--hairline) px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-muted)">
              <span>
                {currentRange.from && currentRange.to
                  ? `${format(currentRange.from, "MMM d ''yy")} — ${format(
                      currentRange.to,
                      "MMM d ''yy"
                    )}`
                  : "No range"}
              </span>
              <button
                type="button"
                className="inv-pagination__btn"
                onClick={() => setPopoverOpen(false)}
              >
                Close
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </section>
  )
}
