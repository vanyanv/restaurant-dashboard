"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect } from "react"
import {
  FileText,
  Home,
  Menu,
  MessageSquareText,
  TrendingUp,
  type LucideIcon,
} from "lucide-react"
import { isTabActive, type MobileTab } from "@/lib/mobile/tabs"

const TAB_ICONS: Record<MobileTab["icon"], LucideIcon> = {
  home: Home,
  pnl: TrendingUp,
  invoices: FileText,
  chat: MessageSquareText,
  more: Menu,
}

export function MobileTabBar({ tabs }: { tabs: MobileTab[] }) {
  const pathname = usePathname() ?? "/m"
  const router = useRouter()
  const chatMode = pathname === "/m/chat" || pathname.startsWith("/m/chat/")

  useEffect(() => {
    const warm = () => {
      for (const tab of tabs) router.prefetch(tab.href)
    }
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        cb: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number
      cancelIdleCallback?: (id: number) => void
    }
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(warm, { timeout: 1500 })
      return () => idleWindow.cancelIdleCallback?.(id)
    }
    const id = window.setTimeout(warm, 350)
    return () => window.clearTimeout(id)
  }, [router, tabs])

  if (chatMode) return null

  return (
    <nav className="m-tabbar" aria-label="Primary">
      {tabs.map((tab) => {
        const active = isTabActive(tab, pathname)
        const Icon = TAB_ICONS[tab.icon]
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch={true}
            className={`m-tabbar__item${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="m-tabbar__icon" aria-hidden />
            <span className="m-tabbar__label">{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
