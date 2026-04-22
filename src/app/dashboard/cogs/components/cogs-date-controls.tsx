"use client"

import { useCallback, useTransition } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import type { Granularity } from "./sections/data"
import { toUrlDate } from "./sections/data"

const PRESETS: Array<{ label: string; days: number }> = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
  { label: "90d", days: 90 },
]

interface CogsDateControlsProps {
  basePath: string
  startDate: Date
  endDate: Date
  granularity: Granularity
  activeDays: number | null
}

export function CogsDateControls({
  basePath,
  startDate,
  endDate,
  granularity,
  activeDays,
}: CogsDateControlsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const navigate = useCallback(
    (params: URLSearchParams) => {
      startTransition(() => {
        router.replace(`${basePath}?${params.toString()}`, { scroll: false })
      })
    },
    [router, basePath]
  )

  const setPreset = (days: number) => {
    const p = new URLSearchParams()
    p.set("days", String(days))
    p.set("gran", granularity)
    navigate(p)
  }

  const setGranularity = (g: Granularity) => {
    const p = new URLSearchParams()
    if (activeDays != null) {
      p.set("days", String(activeDays))
    } else {
      p.set("start", toUrlDate(startDate))
      p.set("end", toUrlDate(new Date(endDate.getTime() - 24 * 60 * 60 * 1000)))
    }
    p.set("gran", g)
    navigate(p)
  }

  const displayEnd = new Date(endDate.getTime() - 24 * 60 * 60 * 1000)
  const dateline =
    startDate.getFullYear() === displayEnd.getFullYear()
      ? `${format(startDate, "MMM d")} – ${format(displayEnd, "MMM d, yyyy")}`
      : `${format(startDate, "MMM d, yyyy")} – ${format(displayEnd, "MMM d, yyyy")}`

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Granularity">
        {(["daily", "weekly", "monthly"] as const).map((g) => (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={granularity === g}
            disabled={isPending}
            onClick={() => setGranularity(g)}
            className={cn(
              "h-7 px-2 text-[11px] font-mono uppercase tracking-[0.12em] border border-(--hairline-bold) rounded-sm",
              granularity === g
                ? "bg-(--ink) text-(--paper)"
                : "text-(--ink-muted) hover:text-(--ink)"
            )}
          >
            {g === "daily" ? "Day" : g === "weekly" ? "Week" : "Month"}
          </button>
        ))}
      </div>
      <span className="h-4 w-px bg-(--hairline)" aria-hidden />
      <div className="flex items-center gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.days}
            type="button"
            disabled={isPending}
            onClick={() => setPreset(p.days)}
            className={cn(
              "h-7 px-2 text-[11px] font-mono tracking-[0.05em] border border-(--hairline-bold) rounded-sm",
              activeDays === p.days
                ? "bg-(--ink) text-(--paper)"
                : "text-(--ink-muted) hover:text-(--ink)"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <span className="h-4 w-px bg-(--hairline)" aria-hidden />
      <span className="font-mono text-[11px] text-(--ink-muted)">{dateline}</span>
    </div>
  )
}
