import type { OverviewPlain } from "@/lib/counter/overview-plain"

/** One store's Overview made plain, shared by the desk and phone tests. */
export const OVERVIEW_PLAIN: OverviewPlain = {
  sentence: "Hollywood sold $7,468, up $298 (4.2%) on the week before, and kept $1,900 after app fees, food, labor and rent.",
  sales: 7468,
  salesVs: { amount: 298, pct: 0.0416, label: "the week before" },
  compareNote: null,
  kept: 1900,
  keptPct: 0.254,
  keptAtMost: null,
  keptNote: null,
  weeks: [
    { window: { start: "2026-08-10", end: "2026-08-16", days: 7, partial: false }, label: "8/10", sales: 7000, kept: 1700, keptPct: 0.243, atMost: false, running: false },
    { window: { start: "2026-08-17", end: "2026-08-23", days: 7, partial: false }, label: "8/17", sales: 7468, kept: 1900, keptPct: 0.254, atMost: false, running: false },
  ],
  statuses: [{ tone: "good", text: "Sales up on the week before" }, { tone: "good", text: "Every cost on file" }],
  stores: [
    { storeId: "hollywood", name: "Hollywood", sales: 7468, salesChange: 298, salesChangePct: 0.0416, orders: 291, laborPct: 0.21, laborMissingDays: 0 },
  ],
  needs: [
    { key: "alerts-MENU_ITEM", tone: "warn", what: "12 menu items sold far above or below normal", why: null, action: { label: "Review items", href: "/dashboard/alerts" } },
  ],
}
