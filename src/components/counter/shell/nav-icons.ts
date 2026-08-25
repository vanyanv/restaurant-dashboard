import type { LucideIcon } from "lucide-react"
import {
  LayoutDashboard,
  MessageSquare,
  Bell,
  Receipt,
  ChartLine,
  Wallet,
  Coins,
  Users,
  BookOpen,
  ChefHat,
  FileText,
  Package,
  Carrot,
  Truck,
  Store,
  Settings2,
  Activity,
} from "lucide-react"

/**
 * `nav.ts` deliberately stores `icon` as a plain string (note 24: it stays
 * render-free) so this is the one place a name resolves to a component. Kept
 * as a static map rather than `(lucide as Record<string, LucideIcon>)[name]`
 * so an icon that doesn't exist in the installed version is a build-time
 * TypeScript error, not a silently blank rail row discovered in production.
 *
 * It lives in its own module because TWO surfaces now draw the seventeen
 * destinations: the rail, and the ⌘K palette's "Go to" group. The palette
 * offering a page under a different glyph than the rail draws it is exactly
 * the drift `NAV_GROUPS` exists to prevent — one list, and now one icon map.
 */
export const NAV_ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  MessageSquare,
  Bell,
  Receipt,
  ChartLine,
  Wallet,
  Coins,
  Users,
  BookOpen,
  ChefHat,
  FileText,
  Package,
  Carrot,
  Truck,
  Store,
  Settings2,
  Activity,
}
