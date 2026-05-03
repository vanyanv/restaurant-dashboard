/** Subsystems shown on the command bridge. The order here is the order
 * they render in the system-health strip. */
export const SYSTEMS = ["db", "r2", "cache", "auth", "syncs"] as const
export type System = (typeof SYSTEMS)[number]

/** Per-system identity color. References the editorial ink tokens added
 * in editorial.css. Used for register marks, panel headers, and the
 * system's own chart line. NEVER as a status color — status uses
 * --ink-ledger / --ink-ochre / --accent regardless of system. */
export const SYSTEM_INK: Record<System, string> = {
  db:     "var(--ink-stamp)",
  r2:     "var(--ink-terracotta)",
  cache:  "var(--ink-ledger)",
  auth:   "var(--ink-plum)",
  syncs:  "var(--ink-olive)",
}

export const SYSTEM_LABEL: Record<System, string> = {
  db:     "DB",
  r2:     "R2",
  cache:  "CACHE",
  auth:   "AUTH",
  syncs:  "SYNCS",
}

/** Where each pill links on click. */
export const SYSTEM_HREF: Record<System, string> = {
  db:     "/dashboard/monitoring/infrastructure#db",
  r2:     "/dashboard/monitoring/infrastructure#r2",
  cache:  "/dashboard/monitoring/cache",
  auth:   "/dashboard/monitoring/people",
  syncs:  "/dashboard/monitoring/activity#syncs",
}

export type StatusTone = "ok" | "warn" | "danger"

export const STATUS_COLOR: Record<StatusTone, string> = {
  ok:     "var(--ink-ledger)",
  warn:   "var(--ink-ochre)",
  danger: "var(--accent)",
}
