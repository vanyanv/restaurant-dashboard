"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  CHANGE_EVENT,
  getRanked,
  recordNavClick,
  type RankedEntry,
} from "@/lib/nav-frequency"
import { flatNavItems } from "@/components/app-sidebar"

const TOP_N = 5

export function NavFrequent() {
  const [entries, setEntries] = React.useState<RankedEntry[]>([])
  const pathname = usePathname() ?? ""

  React.useEffect(() => {
    const refresh = () => setEntries(getRanked(TOP_N))
    refresh()
    window.addEventListener("storage", refresh)
    window.addEventListener(CHANGE_EVENT, refresh)
    return () => {
      window.removeEventListener("storage", refresh)
      window.removeEventListener(CHANGE_EVENT, refresh)
    }
  }, [])

  const resolved = entries
    .map((entry) => {
      const meta = flatNavItems.get(entry.pathname)
      if (!meta) return null
      return { ...entry, label: meta.label, Icon: meta.icon }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  if (resolved.length === 0) return null

  return (
    <div className="editorial-nav-section">
      <div className="editorial-nav-section-label">
        <span>Frequent</span>
      </div>
      <div>
        {resolved.map((entry) => {
          const active = pathname === entry.pathname
          const Icon = entry.Icon
          return (
            <Link
              key={entry.pathname}
              href={entry.pathname}
              onClick={() => recordNavClick(entry.pathname)}
              className={`editorial-nav-item ${active ? "is-active" : ""}`}
            >
              {Icon && <Icon className="nav-icon" />}
              <span className="nav-label">{entry.label}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
