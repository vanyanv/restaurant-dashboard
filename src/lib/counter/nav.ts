/**
 * The seventeen destinations the rail reaches, declared once.
 *
 * Note 24: "A rail item is a decision, not an inventory." The pre-Counter
 * dashboard had thirty-two entries, which is a table of contents rather than
 * navigation. Seventeen fits in one glance without scrolling.
 *
 * Pages that absorbed another page keep it as a VIEW rather than a rail item —
 * Menu holds Items, Profit and Mix; COGS holds theoretical-vs-actual — so this
 * list is destinations, not screens. And a per-store page is the store
 * switcher's destination, not an eighteenth item (note 25).
 */

export type NavId =
  | "overview" | "ask" | "needs-you" | "orders"
  | "analytics" | "pnl" | "cogs" | "labor"
  | "menu" | "recipes"
  | "invoices" | "inventory" | "ingredients" | "vendors"
  | "stores" | "settings" | "monitoring"

export interface NavItem {
  id: NavId
  label: string
  href: string
  /** lucide icon name, resolved by the Rail so this module stays render-free. */
  icon: string
  /**
   * When true, only an exact path match lights this item. Overview owns
   * `/dashboard` itself; without this a prefix match would light all seventeen.
   */
  exact?: boolean
}

export interface NavGroup {
  caption: string
  items: NavItem[]
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    caption: "Today",
    items: [
      { id: "overview", label: "Overview", href: "/dashboard", icon: "LayoutDashboard", exact: true },
      { id: "ask", label: "Ask", href: "/dashboard/ask", icon: "MessageSquare" },
      { id: "needs-you", label: "Needs you", href: "/dashboard/needs-you", icon: "Bell" },
      { id: "orders", label: "Orders", href: "/dashboard/orders", icon: "Receipt" },
    ],
  },
  {
    caption: "Money",
    items: [
      { id: "analytics", label: "Analytics", href: "/dashboard/analytics", icon: "ChartLine" },
      { id: "pnl", label: "P&L", href: "/dashboard/pnl", icon: "Wallet" },
      { id: "cogs", label: "COGS", href: "/dashboard/cogs", icon: "Coins" },
      { id: "labor", label: "Labor", href: "/dashboard/labor", icon: "Users" },
    ],
  },
  {
    caption: "Menu",
    items: [
      { id: "menu", label: "Menu", href: "/dashboard/menu", icon: "BookOpen" },
      { id: "recipes", label: "Recipes", href: "/dashboard/recipes", icon: "ChefHat" },
    ],
  },
  {
    caption: "Stock and suppliers",
    items: [
      { id: "invoices", label: "Invoices", href: "/dashboard/invoices", icon: "FileText" },
      { id: "inventory", label: "Inventory", href: "/dashboard/inventory", icon: "Package" },
      { id: "ingredients", label: "Ingredients", href: "/dashboard/ingredients", icon: "Carrot" },
      { id: "vendors", label: "Vendors", href: "/dashboard/vendors", icon: "Truck" },
    ],
  },
  {
    caption: "Admin",
    items: [
      { id: "stores", label: "Stores", href: "/dashboard/stores", icon: "Store" },
      { id: "settings", label: "Settings", href: "/dashboard/settings", icon: "Settings2" },
      { id: "monitoring", label: "Monitoring", href: "/dashboard/admin/monitoring", icon: "Activity" },
    ],
  },
] as const

const ALL = NAV_GROUPS.flatMap((g) => g.items)

export function navById(id: NavId): NavItem {
  const item = ALL.find((i) => i.id === id)
  // Throwing rather than returning undefined: a missing destination is a
  // programming error, and a silent undefined renders an unlabelled rail row.
  if (!item) throw new Error(`unknown nav id: ${id}`)
  return item
}

/**
 * A destination stays lit for its own children, because the route IS the
 * hierarchy (note 48): `/dashboard/invoices/I28517` is still Invoices, which
 * is where the breadcrumb and the phone's back button come from.
 */
export function isActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
