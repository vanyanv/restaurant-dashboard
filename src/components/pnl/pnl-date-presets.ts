import type { Granularity } from "@/lib/pnl"

export interface PnLRangeState {
  startDate: Date
  endDate: Date
  granularity: Granularity
  /** The preset that produced this state, if any. Used to highlight the active pill. */
  preset?: string
}

function startOfDay(d: Date): Date {
  const n = new Date(d)
  n.setHours(0, 0, 0, 0)
  return n
}

function thisWeekRange(): { start: Date; end: Date } {
  const today = startOfDay(new Date())
  const day = today.getDay()
  const start = new Date(today)
  start.setDate(today.getDate() - day)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { start, end }
}

export const PNL_PRESETS: { key: string; label: string; compute: () => PnLRangeState }[] = [
  {
    key: "today",
    label: "Today",
    compute: () => {
      const d = startOfDay(new Date())
      return { startDate: d, endDate: d, granularity: "daily", preset: "today" }
    },
  },
  {
    key: "yesterday",
    label: "Yesterday",
    compute: () => {
      const d = startOfDay(new Date())
      d.setDate(d.getDate() - 1)
      return { startDate: d, endDate: d, granularity: "daily", preset: "yesterday" }
    },
  },
  {
    key: "thisWeek",
    label: "This Week",
    compute: () => {
      const { start, end } = thisWeekRange()
      return { startDate: start, endDate: end, granularity: "weekly", preset: "thisWeek" }
    },
  },
  {
    key: "lastWeek",
    label: "Last Week",
    compute: () => {
      const { start, end } = thisWeekRange()
      start.setDate(start.getDate() - 7)
      end.setDate(end.getDate() - 7)
      return { startDate: start, endDate: end, granularity: "weekly", preset: "lastWeek" }
    },
  },
  {
    key: "thisMonth",
    label: "This Month",
    compute: () => {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      const end = startOfDay(new Date())
      return { startDate: start, endDate: end, granularity: "monthly", preset: "thisMonth" }
    },
  },
  {
    key: "lastMonth",
    label: "Last Month",
    compute: () => {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const end = new Date(now.getFullYear(), now.getMonth(), 0)
      return { startDate: start, endDate: end, granularity: "monthly", preset: "lastMonth" }
    },
  },
  {
    key: "last8Weeks",
    label: "Last 8 Weeks",
    compute: () => {
      const end = startOfDay(new Date())
      const start = new Date(end)
      start.setDate(start.getDate() - 7 * 8 + 1)
      return { startDate: start, endDate: end, granularity: "weekly", preset: "last8Weeks" }
    },
  },
  {
    key: "last6Months",
    label: "Last 6 Months",
    compute: () => {
      const end = startOfDay(new Date())
      const start = new Date(end.getFullYear(), end.getMonth() - 5, 1)
      return { startDate: start, endDate: end, granularity: "monthly", preset: "last6Months" }
    },
  },
]

export function defaultPnLRangeState(): PnLRangeState {
  return PNL_PRESETS.find((p) => p.key === "last8Weeks")!.compute()
}

export function startOfDayLocal(d: Date): Date {
  return startOfDay(d)
}
