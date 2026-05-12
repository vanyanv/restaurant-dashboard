import type { Role } from "@/generated/prisma/client"

export type MobileTabIcon = "home" | "pnl" | "invoices" | "chat" | "more"

export type MobileTab = {
  href: string
  label: string
  icon: MobileTabIcon
  /** Pathname prefixes that should mark this tab active. */
  matches: string[]
}

export type MobileSection = {
  href: string
  label: string
  /** Department caption shown in JetBrains Mono above the row in the More sheet. */
  dept: string
  /** Higher-level job grouping so the More page scans as tasks, not a directory. */
  group: string
}

const OWNER_TABS: MobileTab[] = [
  { href: "/m", label: "Home", icon: "home", matches: ["/m"] },
  { href: "/m/pnl", label: "P&L", icon: "pnl", matches: ["/m/pnl"] },
  {
    href: "/m/invoices",
    label: "Invoices",
    icon: "invoices",
    matches: ["/m/invoices"],
  },
  { href: "/m/chat", label: "Chat", icon: "chat", matches: ["/m/chat"] },
  { href: "/m/more", label: "More", icon: "more", matches: ["/m/more"] },
]

const DEV_MORE: MobileSection[] = [
  { href: "/m/monitoring", label: "Monitoring", dept: "DEV", group: "Admin" },
]

const OWNER_MORE: MobileSection[] = [
  { href: "/m/forecasts", label: "Forecasts", dept: "NEXT", group: "Plan service" },
  { href: "/m/labor", label: "Labor", dept: "STAFF", group: "Plan service" },
  { href: "/m/operations", label: "Operations", dept: "DAILY", group: "Run today" },
  { href: "/m/count", label: "Stock count", dept: "COUNTS", group: "Run today" },
  { href: "/m/orders", label: "Orders", dept: "LEDGER", group: "Find records" },
  { href: "/m/analytics", label: "Analytics", dept: "SALES", group: "Read performance" },
  { href: "/m/cogs", label: "COGS", dept: "COSTS", group: "Read performance" },
  { href: "/m/product-mix", label: "Product Mix", dept: "MIX", group: "Read performance" },
  { href: "/m/menu", label: "Menu", dept: "ITEMS", group: "Catalog" },
  { href: "/m/recipes", label: "Recipes", dept: "BUILD", group: "Catalog" },
  { href: "/m/ingredients", label: "Ingredients", dept: "COSTS", group: "Catalog" },
  { href: "/m/stores", label: "Stores", dept: "PORTFOLIO", group: "Admin" },
  { href: "/m/settings", label: "Settings", dept: "ACCOUNT", group: "Admin" },
]

export function getTabsForRole(_role?: Role): MobileTab[] {
  return OWNER_TABS
}

export function getMoreForRole(role?: Role): MobileSection[] {
  // DEVELOPER is a superset of OWNER and additionally sees the Bridge row.
  if (role === "DEVELOPER") return [...OWNER_MORE, ...DEV_MORE]
  return OWNER_MORE
}

export function isTabActive(tab: MobileTab, pathname: string): boolean {
  if (tab.href === "/m") return pathname === "/m"
  return tab.matches.some((m) => pathname === m || pathname.startsWith(m + "/"))
}
