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

/*
 * Three of these hrefs pointed at routes that have never existed, and because
 * the rail renders on every Counter page they were 404s reachable from all 22
 * of them. Verified live, not inferred:
 *
 *   /dashboard/needs-you  404  →  /dashboard/alerts
 *   /dashboard/inventory  404  →  /dashboard/operations/inventory
 *   /dashboard/vendors    404  →  /dashboard/operations/vendors
 *
 * The LABELS were right and stay. "Needs you" is the prototype's own rail name
 * for `P.alerts` (prototype line 2256: "Alerts + Decisions → Needs you"), so
 * the id, the label and the bell are what it intended; only the destination
 * was wrong. Inventory and Vendors both live one level deeper than the rail
 * assumed, under `/dashboard/operations/`.
 *
 * An href here is not checked by anything — `npm run tokens` reads Counter
 * design rules, not route existence, and a `<Link>` to a missing route is
 * valid TypeScript. The check is `scripts/counter-lint.ts`' job only if
 * somebody teaches it; until then, changing one of these means loading it.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    caption: "Today",
    items: [
      { id: "overview", label: "Overview", href: "/dashboard", icon: "LayoutDashboard", exact: true },
      { id: "ask", label: "Ask", href: "/dashboard/ask", icon: "MessageSquare" },
      { id: "needs-you", label: "Needs you", href: "/dashboard/alerts", icon: "Bell" },
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
      { id: "inventory", label: "Inventory", href: "/dashboard/operations/inventory", icon: "Package" },
      { id: "ingredients", label: "Ingredients", href: "/dashboard/ingredients", icon: "Carrot" },
      { id: "vendors", label: "Vendors", href: "/dashboard/operations/vendors", icon: "Truck" },
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

/**
 * The eight monitoring tabs, in the prototype's own order.
 *
 * `VIEWS.monitoring` (prototype line 8129): "Eight tabs, because the app runs
 * eight. Bridge first, because it is the one that answers 'is anything broken'
 * without being read." The prototype draws them with `viewTabs()` as a `.seg`
 * in `.phactions` — page chrome, beside the date control, on every tab.
 *
 * They were a TABLE on the hub until now ("The other pages", six rows of a
 * label and a sentence), which is why the hub rendered a `.sec`, a
 * `.sec__head` and a `.tbl` the design does not have. A table of links is a
 * page telling you where else to go; a segmented control is the place you
 * already are. The design chose the second, and the sentences it drops were
 * never on the screen it was drawn for.
 *
 * NOT `NavItem`s and not in `NAV_GROUPS`: a monitoring tab is not a rail
 * destination (note 24 — the rail is seventeen items and "a monitoring tab is
 * not a destination", prototype line 2207). `Monitoring` itself is the rail
 * item; these are what it opens onto.
 *
 * The labels are the prototype's, not the page titles: `.seg button` is
 * 11px mono at .08em tracking and eight of them share one row, so "Infra"
 * fits where "Infrastructure" wraps the control onto a second line.
 */
export interface SubNavItem {
  label: string
  href: string
}

/**
 * `P.usage`'s three tabs — `seg: ['Usage','Menu item costs','Vendor prices']`.
 *
 * The prototype's `seg` navigates NOWHERE. It is a display-only control, which
 * is why `P.usage.desk()` stacks all three views onto one page and comments
 * that "a tab label with nothing behind it is the same broken promise as a
 * shortcut that opens nothing".
 *
 * Ours are three real routes, and two of them were already built before this
 * page was: menu item costs is `/dashboard/menu-profit`, and vendor prices —
 * "the same item, every vendor that sells it" — is the vendor page's basket.
 * So the product-usage page declines to rebuild either (see its client) and
 * carries this instead. The promise the labels make is kept by going there,
 * rather than by computing the same figures a second time under a heading.
 */
export const USAGE_TABS: readonly SubNavItem[] = [
  { label: "Usage", href: "/dashboard/operations/product-usage" },
  { label: "Menu item costs", href: "/dashboard/menu-profit" },
  { label: "Vendor prices", href: "/dashboard/operations/vendors" },
] as const

export const MONITORING_TABS: readonly SubNavItem[] = [
  { label: "Bridge", href: "/dashboard/admin/monitoring" },
  { label: "Infra", href: "/dashboard/admin/monitoring/infrastructure" },
  { label: "People", href: "/dashboard/admin/monitoring/people" },
  { label: "Costs", href: "/dashboard/admin/monitoring/costs" },
  { label: "Model", href: "/dashboard/admin/monitoring/ml" },
  { label: "Ingredients", href: "/dashboard/admin/monitoring/ingredient-audit" },
  { label: "Activity", href: "/dashboard/admin/monitoring/activity" },
  { label: "Cache", href: "/dashboard/admin/monitoring/cache" },
] as const

/**
 * The same eight on the phone, DERIVED rather than typed out again.
 *
 * The phone monitoring pages had no sub-navigation at all: seven of the eight
 * were reachable only by typing the URL, which
 * `e2e/mobile/reachability.spec.ts` reports as seven orphans behind one
 * missing bar. The desk has carried this control since the monitoring rebuild.
 *
 * Derived because two hand-written lists of the same eight labels in the same
 * order is a drift waiting to happen — rename a tab on the desk and the phone
 * keeps the old word. `src/proxy.ts` makes exactly this substitution when it
 * sends a phone off `/dashboard/admin/monitoring`, so the mapping is the
 * product's own rather than this file's invention.
 */
/**
 * The prototype's `VIEWS`, which is where most of this product's navigation
 * actually lives — and which we had built almost none of.
 *
 * `GROUPS` (the rail) holds sixteen destinations and ours matches it exactly.
 * Everything else the design draws is reached through a `.seg` bar on its
 * PARENT: "Pages that absorbed another page keep it as a view." So Needs you
 * is a view of Alerts, Product mix a view of Menu, Prices a view of
 * Ingredients, Packaging a view of Vendors, and Start a count a view of
 * Inventory.
 *
 * Without those bars the pages exist and nothing reaches them.
 * `e2e/desktop/reachability.spec.ts` counted nine such pages on the desk and
 * `e2e/mobile/reachability.spec.ts` nine on the phone, and every one of them
 * is a `VIEWS` entry we had not drawn. They are not missing pages; they are a
 * missing navigation.
 *
 * Ours are LINKS rather than the prototype's `data-view` buttons, for the
 * reason `SubNav` gives: our views are real routes, and a route you cannot
 * bookmark or open in a second tab is not a route.
 */
export const ALERT_TABS: readonly SubNavItem[] = [
  { label: "Now", href: "/dashboard/alerts" },
  { label: "This week", href: "/dashboard/decisions" },
] as const

export const INGREDIENT_TABS: readonly SubNavItem[] = [
  { label: "Catalogue", href: "/dashboard/ingredients" },
  { label: "Prices", href: "/dashboard/ingredients/prices" },
] as const

export const VENDOR_TABS: readonly SubNavItem[] = [
  { label: "Vendors", href: "/dashboard/operations/vendors" },
  { label: "Packaging", href: "/dashboard/operations/packaging" },
] as const

export const INVENTORY_TABS: readonly SubNavItem[] = [
  { label: "On hand", href: "/dashboard/operations/inventory" },
  { label: "Counts", href: "/dashboard/operations/inventory/counts" },
  { label: "Start a count", href: "/dashboard/operations/inventory/count/new" },
] as const

/**
 * The Menu family's four views.
 *
 * Every label here is its destination's own name, shortened by dropping the
 * word "Menu" that the section already supplies: "Menu profit" → Profit,
 * "Product mix" → Mix, "Menu catalog" → Catalog.
 *
 * "Catalog" used to read "Items", which was not a shortening of anything — it
 * was a different noun for the same page. The Overview beneath this bar offers
 * a card titled "Catalog" pointing at the same route, and the route's own
 * `PageHead` says "Menu catalog", so one screen carried the tab, the card and
 * the heading calling one page three things, and clicking "Open catalog"
 * landed a reader on a page whose current tab had renamed itself.
 */
export const MENU_TABS: readonly SubNavItem[] = [
  { label: "Overview", href: "/dashboard/menu" },
  { label: "Catalog", href: "/dashboard/menu/catalog" },
  { label: "Profit", href: "/dashboard/menu-profit" },
  { label: "Mix", href: "/dashboard/product-mix" },
] as const

/**
 * The Menu hub's three destination cards read their name and their href from
 * here, so a card cannot point somewhere the tab bar does not go, or call it
 * something the tab bar does not call it.
 *
 * `menu-hub.ts` used to hold its own copies with a docblock claiming they were
 * "derived from nav.ts's own destinations rather than hardcoded here, so a
 * renamed route cannot leave this page pointing at a page that moved" — while
 * the hrefs directly under it were string literals. A comment asserting the
 * exact safety property the code did not have.
 */
export function menuTab(label: "Catalog" | "Profit" | "Mix"): SubNavItem {
  const found = MENU_TABS.find((t) => t.label === label)
  // Unreachable while the array above holds all three; typed as a total
  // function so callers do not each invent a fallback destination.
  if (!found) throw new Error(`MENU_TABS has no "${label}" tab`)
  return found
}

/** The same five bars on the phone. Derived, for the reason below. */
const toPhone = (items: readonly SubNavItem[]): readonly SubNavItem[] =>
  items.map((t) => ({ label: t.label, href: "/m" + t.href.slice("/dashboard".length) }))

export const PHONE_ALERT_TABS = toPhone(ALERT_TABS)
export const PHONE_INGREDIENT_TABS = toPhone(INGREDIENT_TABS)
export const PHONE_VENDOR_TABS = toPhone(VENDOR_TABS)
export const PHONE_INVENTORY_TABS = toPhone(INVENTORY_TABS)
export const PHONE_MENU_TABS = toPhone(MENU_TABS)

/**
 * `VIEWS`'s "One store" tab, which cannot be a constant.
 *
 * The prototype's own note says why: "A per-store page is the store switcher's
 * destination, not a rail item: pick a store, then pick whether you want the
 * group or that store." So the tab's href carries the SELECTED store, and
 * until one is selected there is nothing for it to point at — it is absent
 * rather than dead, which is the same call `Table` makes about a row with no
 * destination.
 *
 * `store` is dropped from the carried query on both tabs and for opposite
 * reasons: on the group link because "All stores" that is filtered to one is
 * not all stores, and on the per-store link because the id is in the path and
 * two sources for one fact is how they come to disagree. Everything else —
 * the range, the comparison — travels, because the tab is a change of view
 * and not a change of window.
 */
export function storeViewTabs(
  base: string,
  storeId: string | null,
  search: string,
  extra: readonly SubNavItem[] = [],
): readonly SubNavItem[] {
  const params = new URLSearchParams(search)
  params.delete("store")
  const qs = params.toString()
  const q = qs ? `?${qs}` : ""
  return [
    { label: "All stores", href: `${base}${q}` },
    ...extra.map((e) => ({ label: e.label, href: `${e.href}${q}` })),
    ...(storeId ? [{ label: "One store", href: `${base}/${storeId}${q}` }] : []),
  ]
}

export const PHONE_MONITORING_TABS: readonly SubNavItem[] = MONITORING_TABS.map(
  (t) => ({
    label: t.label,
    href: t.href.replace("/dashboard/admin/monitoring", "/m/monitoring"),
  }),
)
