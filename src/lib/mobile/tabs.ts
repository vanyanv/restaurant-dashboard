import type { Role } from "@/generated/prisma/client"

export type MobileSection = {
  href: string
  label: string
  /** Department caption shown in JetBrains Mono above the row in the More sheet. */
  dept: string
  /** Higher-level job grouping so the More page scans as tasks, not a directory. */
  group: string
}

const OWNER_MORE: MobileSection[] = [
  { href: "/m/labor", label: "Labor", dept: "STAFF", group: "Plan service" },
  { href: "/m/operations", label: "Operations", dept: "DAILY", group: "Run today" },
  { href: "/m/chat", label: "Chat", dept: "ASK", group: "Run today" },
  { href: "/m/pnl", label: "P&L", dept: "STATEMENT", group: "Read performance" },
  { href: "/m/product-mix", label: "Product Mix", dept: "MIX", group: "Read performance" },
  { href: "/m/menu", label: "Menu", dept: "ITEMS", group: "Catalog" },
  { href: "/m/recipes", label: "Recipes", dept: "BUILD", group: "Catalog" },
  { href: "/m/ingredients", label: "Ingredients", dept: "COSTS", group: "Catalog" },
]

// Dev-only entries, appended for DEVELOPER accounts only.
const DEV_MORE: MobileSection[] = [
  { href: "/m/monitoring", label: "Monitoring", dept: "DEV", group: "Admin" },
]

export function getMoreForRole(role?: Role): MobileSection[] {
  if (role === "DEVELOPER") return [...OWNER_MORE, ...DEV_MORE]
  return OWNER_MORE
}

