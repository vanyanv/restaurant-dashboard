import type { DashboardRange } from "@/lib/dashboard-utils"

const FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
})

/**
 * "Aug 19", or "Aug 13 – Aug 19" for a window.
 *
 * The range picker in the topbar already shows the keyword ("YDAY", "7D"), so
 * section heads and ledger totals name the actual days instead — one screen
 * carrying both a keyword and a date for the same range reads as two ranges.
 * Store-local throughout: a UTC-rendered date is a day out for half the year.
 */
export function rangeDateLabel(range: DashboardRange): string {
  if (range.kind === "custom") {
    const at = (d: string) => FMT.format(new Date(`${d}T12:00:00`))
    return range.startDate === range.endDate
      ? at(range.startDate)
      : `${at(range.startDate)} – ${at(range.endDate)}`
  }

  const end = new Date()
  if (range.days === -1) end.setDate(end.getDate() - 1)
  if (range.days === 1 || range.days === -1) return FMT.format(end)

  const start = new Date(end)
  start.setDate(start.getDate() - (range.days - 1))
  return `${FMT.format(start)} – ${FMT.format(end)}`
}
