"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const CHAPTERS = [
  { index: "§ 08", label: "Masthead", href: "/dashboard/settings" },
  { index: "§ 08.1", label: "Account", href: "/dashboard/settings/account" },
  {
    index: "§ 08.2",
    label: "Standing Orders",
    href: "/dashboard/settings/notifications",
  },
  {
    index: "§ 08.3",
    label: "Preferences",
    href: "/dashboard/settings/preferences",
  },
]

export function ChapterRail() {
  const pathname = usePathname()
  return (
    <nav className="settings-chapter-rail" aria-label="Settings sections">
      {CHAPTERS.map((chapter) => {
        const isActive =
          chapter.href === "/dashboard/settings"
            ? pathname === chapter.href
            : pathname === chapter.href ||
              pathname.startsWith(`${chapter.href}/`)
        return (
          <Link
            key={chapter.href}
            href={chapter.href}
            data-active={isActive ? "true" : undefined}
          >
            <span className="rail-index">{chapter.index}</span>
            <span>{chapter.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
