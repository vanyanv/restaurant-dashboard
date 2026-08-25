import Link from "next/link"
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
import { NAV_GROUPS, isActive, type NavItem } from "@/lib/counter/nav"

/**
 * `nav.ts` deliberately stores `icon` as a plain string (note 24: it stays
 * render-free) so this is the one place a name resolves to a component. Kept
 * as a static map rather than `(lucide as Record<string, LucideIcon>)[name]`
 * so an icon that doesn't exist in the installed version is a build-time
 * TypeScript error, not a silently blank rail row discovered in production.
 */
const ICONS: Record<string, LucideIcon> = {
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

function RailLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(item, pathname)
  const Icon = ICONS[item.icon]
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-ct-sm px-2.5 py-1.5 text-ct-mid transition-colors ${
        active ? "bg-ct-accent-wash text-ct-accent-hi" : "text-ct-ink hover:bg-ct-sunk"
      }`}
    >
      {/* The label beside it is the accessible name — an icon announced
          twice (once by name, once by the label) is noise, not help. */}
      {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0" /> : null}
      <span>{item.label}</span>
    </Link>
  )
}

/**
 * The rail is a landmark with groups (note 24), not a flat list of
 * seventeen: `<nav aria-label="Sections">` contains five `role="group"`
 * elements, each `aria-label`led by its caption, so a screen-reader user
 * hears which set a destination belongs to.
 *
 * `aria-current="page"` — not colour — is what announces the current
 * destination to a screen reader; `bg-ct-accent-wash` is only the sighted
 * affordance for the same fact. Both are set together, from the same
 * `isActive` call, so they can never disagree.
 */
export function Rail({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Sections" className="flex h-full w-[212px] flex-col gap-3 overflow-y-auto p-2.5">
      {NAV_GROUPS.map((group) => (
        <div key={group.caption} role="group" aria-label={group.caption} className="grid gap-px">
          <div className="px-2 pb-1 pt-2 font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">
            {group.caption}
          </div>
          {group.items.map((item) => (
            <RailLink key={item.id} item={item} pathname={pathname} />
          ))}
        </div>
      ))}
    </nav>
  )
}
