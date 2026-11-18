/**
 * What each alert target is, in words, and where it is dealt with.
 *
 * One table, read by the Overview's Needs you and the Alerts page's groups,
 * so the two pages call one kind of alert by one name.
 *
 * `label` is the Overview's button, which opens the Alerts page. `fix` is the
 * Alerts page's own button, which opens the page where that kind of alert is
 * dealt with.
 */
export interface AlertGroupWords {
  one: string
  many: string
  label: string
  fix: { label: string; href: string }
}

export const ALERT_GROUP: Record<string, AlertGroupWords> = {
  MENU_ITEM: {
    one: "menu item sold far above or below normal",
    many: "menu items sold far above or below normal",
    label: "Review items",
    fix: { label: "Open menu items", href: "/dashboard/menu/items" },
  },
  REVENUE: {
    one: "day with unusual sales",
    many: "days with unusual sales",
    label: "See the days",
    fix: { label: "Open analytics", href: "/dashboard/analytics" },
  },
  LABOR: {
    one: "labor alert",
    many: "labor alerts",
    label: "Open alerts",
    fix: { label: "Open labor", href: "/dashboard/labor" },
  },
  REFUNDS: {
    one: "unusual refund",
    many: "unusual refunds",
    label: "Open alerts",
    fix: { label: "Open orders", href: "/dashboard/orders" },
  },
  INGREDIENT: {
    one: "ingredient alert",
    many: "ingredient alerts",
    label: "Open alerts",
    fix: { label: "Open ingredients", href: "/dashboard/ingredients" },
  },
  PRICE: {
    one: "price change",
    many: "price changes",
    label: "Open alerts",
    fix: { label: "Open prices", href: "/dashboard/invoices/prices" },
  },
  PRODUCT: {
    one: "new or changed product",
    many: "new or changed products",
    label: "Open alerts",
    fix: { label: "Open the menu", href: "/dashboard/menu/catalog" },
  },
  STORE_CHECK: {
    one: "store check alert",
    many: "store check alerts",
    label: "Open alerts",
    fix: { label: "Open store checks", href: "/dashboard/checks" },
  },
}

const OTHER: AlertGroupWords = {
  one: "other alert",
  many: "other alerts",
  label: "Open alerts",
  fix: { label: "Open alerts", href: "/dashboard/alerts" },
}

export function alertGroupWords(target: string): AlertGroupWords {
  return ALERT_GROUP[target] ?? OTHER
}

/** Rows counted by target, biggest first. */
export function countByTarget(rows: ReadonlyArray<{ target: string }>): Array<[string, number]> {
  const byTarget = new Map<string, number>()
  for (const a of rows) byTarget.set(a.target, (byTarget.get(a.target) ?? 0) + 1)
  return [...byTarget].sort((a, b) => b[1] - a[1])
}
