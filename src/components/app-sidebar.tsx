"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ChevronRight,
  Store,
  BarChart3,
  Settings2,
  FileText,
  Activity,
  Receipt,
  ChefHat,
  type LucideIcon,
} from "lucide-react"
import { signOut } from "next-auth/react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import { NavFrequent } from "@/components/nav-frequent"
import { recordNavClick } from "@/lib/nav-frequency"

export type NavItem = {
  title: string
  url: string
  icon?: LucideIcon
  items?: { title: string; url: string }[]
}

type NavSection = {
  label: string
  items: NavItem[]
}

const NAV: NavSection[] = [
  {
    label: "Front",
    items: [
      {
        title: "Overview",
        url: "/dashboard",
        icon: BarChart3,
        items: [
          { title: "Sales Summary", url: "/dashboard" },
          { title: "Analytics", url: "/dashboard/analytics" },
          { title: "P&L", url: "/dashboard/pnl" },
          { title: "Menu Performance", url: "/dashboard/menu" },
          { title: "Product Mix", url: "/dashboard/product-mix" },
          { title: "AI Analytics", url: "/dashboard/ai-analytics" },
        ],
      },
      {
        title: "Orders",
        url: "/dashboard/orders",
        icon: Receipt,
      },
      {
        title: "Recipes",
        url: "/dashboard/recipes",
        icon: ChefHat,
      },
      {
        title: "Invoices",
        url: "/dashboard/invoices",
        icon: FileText,
        items: [
          { title: "All Invoices", url: "/dashboard/invoices" },
          { title: "Needs Review", url: "/dashboard/invoices?status=REVIEW" },
        ],
      },
    ],
  },
  {
    label: "Back of House",
    items: [
      {
        title: "Operations",
        url: "/dashboard/operations",
        icon: Activity,
        items: [
          { title: "Overview", url: "/dashboard/operations" },
          { title: "Product Usage", url: "/dashboard/operations/product-usage" },
          { title: "Costs", url: "/dashboard/operations/costs" },
          { title: "Vendors", url: "/dashboard/operations/vendors" },
        ],
      },
      {
        title: "Stores",
        url: "/dashboard/stores",
        icon: Store,
        items: [
          { title: "All Stores", url: "/dashboard/stores" },
          { title: "Create Store", url: "/dashboard/stores/new" },
        ],
      },
      {
        title: "Settings",
        url: "/dashboard/settings",
        icon: Settings2,
        items: [
          { title: "Account", url: "/dashboard/settings/account" },
          { title: "Notifications", url: "/dashboard/settings/notifications" },
          { title: "Preferences", url: "/dashboard/settings/preferences" },
        ],
      },
    ],
  },
]

const STORAGE_KEY = "nav-main:open-sections"

export type FlatNavEntry = {
  label: string
  icon?: LucideIcon
}

export const flatNavItems: Map<string, FlatNavEntry> = (() => {
  const map = new Map<string, FlatNavEntry>()
  for (const section of NAV) {
    for (const item of section.items) {
      if (!map.has(item.url)) {
        map.set(item.url, { label: item.title, icon: item.icon })
      }
      if (item.items) {
        for (const sub of item.items) {
          if (!map.has(sub.url)) {
            map.set(sub.url, { label: sub.title, icon: item.icon })
          }
        }
      }
    }
  }
  return map
})()

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar
      collapsible="icon"
      className="editorial-sidebar"
      {...props}
    >
      <SidebarHeader className="p-0">
        <EditorialBrand />
      </SidebarHeader>

      <SidebarContent className="px-0 gap-0">
        <NavFrequent />
        {NAV.map((section) => (
          <div key={section.label} className="editorial-nav-section">
            <div className="editorial-nav-section-label">
              <span>{section.label}</span>
            </div>
            <EditorialNav items={section.items} />
          </div>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-0">
        <EditorialUserCard />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}

function EditorialBrand() {
  return (
    <div className="editorial-brand">
      <Link
        href="/dashboard"
        className="brand-logo-link"
        aria-label="Chris N Eddy's — Home"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="Chris N Eddy's"
          width={1280}
          height={720}
          className="brand-logo-img"
        />
      </Link>
      <div className="brand-details">
        <div className="brand-issue">
          Vol. 04 · No. {new Date().getDate().toString().padStart(2, "0")}
        </div>
        <div className="brand-meta">
          <span className="live-dot" />
          <span>On the line · Live</span>
        </div>
      </div>
    </div>
  )
}

function EditorialNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname() ?? ""
  const [openMap, setOpenMap] = React.useState<Record<string, boolean>>({})
  const hasHydrated = React.useRef(false)

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) setOpenMap(JSON.parse(raw) as Record<string, boolean>)
    } catch {}
    hasHydrated.current = true
  }, [])

  React.useEffect(() => {
    if (!hasHydrated.current) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(openMap))
    } catch {}
  }, [openMap])

  const isItemActive = (item: NavItem): boolean => {
    if (pathname === item.url) return true
    if (item.items?.some((sub) => pathname === sub.url.split("?")[0])) return true
    // top-level section match (e.g. /dashboard/invoices)
    if (item.url !== "/dashboard" && pathname.startsWith(item.url)) return true
    return false
  }

  return (
    <div>
      {items.map((item) => {
        const active = isItemActive(item)
        const Icon = item.icon
        const hasChildren = !!item.items?.length

        if (!hasChildren) {
          return (
            <Link
              key={item.title}
              href={item.url}
              onClick={() => recordNavClick(item.url)}
              className={`editorial-nav-item ${active ? "is-active" : ""}`}
            >
              {Icon && <Icon className="nav-icon" />}
              <span className="nav-label">{item.title}</span>
            </Link>
          )
        }

        const isOpen = openMap[item.title] ?? active
        return (
          <Collapsible
            key={item.title}
            open={isOpen}
            onOpenChange={(o) =>
              setOpenMap((prev) => ({ ...prev, [item.title]: o }))
            }
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className={`editorial-nav-item w-full ${active ? "is-active" : ""}`}
                data-state={isOpen ? "open" : "closed"}
              >
                {Icon && <Icon className="nav-icon" />}
                <span className="nav-label">{item.title}</span>
                <ChevronRight className="nav-chev" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="editorial-nav-subitems">
                {item.items!.map((sub) => {
                  const subActive =
                    pathname === sub.url.split("?")[0] ||
                    (sub.url.includes("?")
                      ? false
                      : pathname === sub.url)
                  return (
                    <Link
                      key={sub.title}
                      href={sub.url}
                      onClick={() => recordNavClick(sub.url)}
                      className={`editorial-nav-subitem ${subActive ? "is-active" : ""}`}
                    >
                      {sub.title}
                    </Link>
                  )
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )
      })}
    </div>
  )
}

function EditorialUserCard() {
  const [name] = React.useState("Owner")
  const [role] = React.useState("Proprietor")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="editorial-user-card w-full text-left">
          <div className="user-avatar">{name.charAt(0).toUpperCase()}</div>
          <div className="flex-1 min-w-0">
            <div className="user-name">{name}</div>
            <div className="user-role">{role}</div>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-56"
      >
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings/account">Account</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings/notifications">Notifications</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => signOut({ callbackUrl: "/login" })}
          className="text-[var(--accent)]"
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
