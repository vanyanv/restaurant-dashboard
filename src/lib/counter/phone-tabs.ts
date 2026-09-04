/**
 * The phone's five tabs, and which one is lit on every route.
 *
 * `TABS` (prototype line 8204) is five entries and one of them is not a
 * destination like the others:
 *
 *     { k: 'today',    label: 'Today',    icon: 'grid', go: 'overview'  },
 *     { k: 'count',    label: 'Count',    icon: 'clip', go: 'inventory' },
 *     { k: 'ask',      label: 'Ask',      icon: 'ask',  go: 'ask', mid: true },
 *     { k: 'invoices', label: 'Invoices', icon: 'doc',  go: 'invoices'  },
 *     { k: 'more',     label: 'More',     icon: 'more', go: 'more'      }
 *
 * `mid: true` is the raised circle — `.mtab--ask .bub`, a 46px accent disc
 * pulled 22px up out of the bar. It is the phone's whole answer to the desk's
 * ⌘K palette (note: "A palette is the wrong answer at 316px"), and the app
 * shipped a five-item bar without it, so the one control the design puts in
 * the reader's thumb was the one control the product did not have.
 *
 * ## Why a table and not a prefix rule
 *
 * Every prototype page declares `tab: '<k>'` on itself, and the assignment is
 * NOT derivable from the URL. Three routes under `/dashboard/operations`
 * light three different tabs:
 *
 *     /operations                    -> more
 *     /operations/inventory          -> count
 *     /operations/vendors            -> invoices
 *
 * and Analytics, P&L, COGS, Labor and Product mix all light TODAY even though
 * none of them is the overview. "Today" is the tab for reading the business,
 * not for one page. A prefix-per-tab rule cannot express that, so this is the
 * design's own table, transcribed, with the deepest prefix winning.
 */

export type PhoneTabId = "today" | "count" | "ask" | "invoices" | "more"

export interface PhoneTab {
  id: PhoneTabId
  label: string
  href: string
  /** Key into `PHONE_TAB_ICONS` — the prototype's own 16-box glyphs. */
  icon: "grid" | "clip" | "ask" | "doc" | "more"
  /** The raised circle. Exactly one tab carries it. */
  mid?: boolean
}

export const PHONE_TABS: readonly PhoneTab[] = [
  { id: "today", label: "Today", href: "/m", icon: "grid" },
  { id: "count", label: "Count", href: "/m/operations/inventory", icon: "clip" },
  { id: "ask", label: "Ask", href: "/m/ask", icon: "ask", mid: true },
  { id: "invoices", label: "Invoices", href: "/m/invoices", icon: "doc" },
  { id: "more", label: "More", href: "/m/more", icon: "more" },
] as const

/**
 * Every route this phone has, against the tab the prototype lights on it.
 *
 * Order is irrelevant — `activePhoneTab` takes the LONGEST match — so these
 * are grouped by tab to read as the design's own list rather than as a router.
 * A route absent from here falls to `today`, which is what the prototype does
 * for its two doors (`forbidden` and `notfound` both declare `tab: 'today'`).
 */
const TAB_OF: readonly (readonly [string, PhoneTabId])[] = [
  // today — the overview and everything that reads the business
  ["/m", "today"],
  ["/m/alerts", "today"],
  ["/m/decisions", "today"],
  ["/m/orders", "today"],
  ["/m/analytics", "today"],
  ["/m/pnl", "today"],
  ["/m/cogs", "today"],
  ["/m/labor", "today"],
  ["/m/menu-profit", "today"],
  ["/m/product-mix", "today"],

  // ask
  ["/m/ask", "ask"],
  // The editorial chat is the same job on an older surface, and until it is
  // rebuilt a reader who lands there should see which tab they are on.
  ["/m/chat", "ask"],

  // count — the three inventory routes, and nothing else
  ["/m/operations/inventory", "count"],
  ["/m/count", "count"],

  // invoices — money coming IN as paperwork: bills, what they bought, who sold it
  ["/m/invoices", "invoices"],
  ["/m/ingredients", "invoices"],
  ["/m/operations/vendors", "invoices"],

  // more — the catalogue, the admin surfaces, and the More sheet itself
  ["/m/more", "more"],
  ["/m/menu", "more"],
  ["/m/recipes", "more"],
  ["/m/operations", "more"],
  ["/m/operations/packaging", "more"],
  ["/m/operations/product-usage", "more"],
  ["/m/stores", "more"],
  ["/m/settings", "more"],
  ["/m/monitoring", "more"],
] as const

/**
 * Which tab is lit, by deepest matching prefix.
 *
 * A destination stays lit for its children, for `nav.ts`' reason: the route IS
 * the hierarchy, so `/m/invoices/I28517` is still Invoices. Deepest-wins is
 * what lets `/m/operations/inventory` be Count while `/m/operations` above it
 * is More.
 */
export function activePhoneTab(pathname: string): PhoneTabId {
  let best: PhoneTabId = "today"
  let bestLength = -1
  for (const [prefix, tab] of TAB_OF) {
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
    if (prefix.length <= bestLength) continue
    best = tab
    bestLength = prefix.length
  }
  return best
}
