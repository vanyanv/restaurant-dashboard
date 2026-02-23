import { format } from "date-fns"

export function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate + "T00:00:00")
  const end = new Date(endDate + "T00:00:00")
  if (startDate === endDate) {
    return format(start, "MMM d, yyyy")
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`
  }
  return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`
}

export function getLastSyncText(lastSyncAt: Date | string | null | undefined): string {
  if (!lastSyncAt) return "Never synced"
  const date =
    typeof lastSyncAt === "string" ? new Date(lastSyncAt) : lastSyncAt
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return "Just synced"
  if (diffMin < 60) return `Last synced ${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `Last synced ${diffHours}h ago`
  return `Last synced ${Math.floor(diffHours / 24)}d ago`
}
