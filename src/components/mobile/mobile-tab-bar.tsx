"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect } from "react"
import { isTabActive, type MobileTab } from "@/lib/mobile/tabs"

export function MobileTabBar({ tabs }: { tabs: MobileTab[] }) {
  const pathname = usePathname() ?? "/m"
  const router = useRouter()

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

  return (
    <nav className="m-tabbar" aria-label="Primary">
      {tabs.map((tab) => {
        const active = isTabActive(tab, pathname)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch={true}
            className={`m-tabbar__item${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
