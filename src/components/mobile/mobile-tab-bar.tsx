"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { isTabActive, type MobileTab } from "@/lib/mobile/tabs"

export function MobileTabBar({ tabs }: { tabs: MobileTab[] }) {
  const pathname = usePathname() ?? "/m"
  return (
    <nav className="m-tabbar" aria-label="Primary">
      {tabs.map((tab) => {
        const active = isTabActive(tab, pathname)
        return (
          <Link
            key={tab.href}
            href={tab.href}
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
