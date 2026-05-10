import type { Role } from "@/generated/prisma/client"

export type MobileTab = {
  href: string
  label: string
  /** Pathname prefixes that should mark this tab active. */
  matches: string[]
}

export type MobileSection = {
  href: string
  label: string
  /** Department caption shown in JetBrains Mono above the row in the More sheet. */
  dept: string
}

const OWNER_TABS: MobileTab[] = [
  { href: "/m", label: "Home", matches: ["/m"] },
  { href: "/m/pnl", label: "P&L", matches: ["/m/pnl"] },
  { href: "/m/invoices", label: "Invoices", matches: ["/m/invoices"] },
  { href: "/m/chat", label: "Chat", matches: ["/m/chat"] },
  { href: "/m/more", label: "More", matches: ["/m/more"] },
]

const DEV_MORE: MobileSection[] = [
  { href: "/m/monitoring", label: "Monitoring", dept: "DEV" },
]

const OWNER_MORE: MobileSection[] = [
  { href: "/m/forecasts", label: "Forecasts", dept: "INTELLIGENCE" },
  { href: "/m/labor", label: "Labor", dept: "INTELLIGENCE" },
  { href: "/m/count", label: "Stock count", dept: "COUNTS" },
  { href: "/m/analytics", label: "Analytics", dept: "PERFORMANCE" },
  { href: "/m/orders", label: "Orders", dept: "LEDGER" },
  { href: "/m/cogs", label: "COGS", dept: "COSTS" },
  { href: "/m/product-mix", label: "Product Mix", dept: "PERFORMANCE" },
  { href: "/m/stores", label: "Stores", dept: "PORTFOLIO" },
  { href: "/m/operations", label: "Operations", dept: "DAILY" },
  { href: "/m/menu", label: "Menu", dept: "CATALOG" },
  { href: "/m/recipes", label: "Recipes", dept: "CATALOG" },
  { href: "/m/ingredients", label: "Ingredients", dept: "CATALOG" },
  { href: "/m/settings", label: "Settings", dept: "ACCOUNT" },
]

export function getTabsForRole(_role?: Role): MobileTab[] {
  return OWNER_TABS
}

export function getMoreForRole(role?: Role): MobileSection[] {
  // DEVELOPER is a superset of OWNER and additionally sees the Bridge row.
  if (role === "DEVELOPER") return [...DEV_MORE, ...OWNER_MORE]
  return OWNER_MORE
}

export function isTabActive(tab: MobileTab, pathname: string): boolean {
  if (tab.href === "/m") return pathname === "/m"
  return tab.matches.some(
    (m) => pathname === m || pathname.startsWith(m + "/")
  )
}
