// Resolve a {startDate, endDate} pair from optional explicit ISO date strings,
// falling back to a "last N days" window. Centralizes the date-range parsing
// repeated across server actions. NOT marked "use server" — pure helper, may
// be imported by both server and (test) client code.

export interface DateRangeOptions {
  startDate?: string
  endDate?: string
  days?: number
}

export interface DateRange {
  startDate: Date
  endDate: Date
}

export function parseDateRange(
  options: DateRangeOptions | undefined,
  defaultDays: number
): DateRange {
  const { startDate: startStr, endDate: endStr, days = defaultDays } = options ?? {}

  if (startStr && endStr) {
    return {
      startDate: new Date(startStr + "T00:00:00"),
      endDate: new Date(endStr + "T23:59:59"),
    }
  }

  const endDate = new Date()
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - days)
  return { startDate, endDate }
}
