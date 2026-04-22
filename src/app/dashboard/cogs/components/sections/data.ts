import { startOfDay, subDays } from "date-fns"
import type { Granularity } from "@/lib/cogs"

export type { Granularity }

export interface CogsFilters {
  /** end-exclusive */
  startDate: Date
  endDate: Date
  granularity: Granularity
}

const VALID_GRAN = new Set<Granularity>(["daily", "weekly", "monthly"])

export function parseCogsFilters(sp: {
  start?: string
  end?: string
  days?: string
  gran?: string
}): CogsFilters {
  const today = startOfDay(new Date())
  const endExclusive = new Date(today.getTime() + 24 * 60 * 60 * 1000)

  let startDate: Date
  let endDate: Date

  if (sp.start && sp.end) {
    startDate = startOfDay(new Date(sp.start))
    endDate = new Date(startOfDay(new Date(sp.end)).getTime() + 24 * 60 * 60 * 1000)
  } else {
    const days = Math.max(1, Math.min(365, Number(sp.days ?? 30)))
    startDate = subDays(today, days - 1)
    endDate = endExclusive
  }

  const granularity: Granularity = VALID_GRAN.has(sp.gran as Granularity)
    ? (sp.gran as Granularity)
    : "daily"

  return { startDate, endDate, granularity }
}

export function toUrlDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
