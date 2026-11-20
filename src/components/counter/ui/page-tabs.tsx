"use client"

import type { ReactNode } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Tabs } from "./tabs"

export type PageTab = {
  key: string
  label: string
  /** Drawn only while this tab is open, so a closed tab's sections are not unwrapped. */
  content: ReactNode
}

/**
 * A page split into tabs — DESIGN.md "Page layout" rule 2: past the answer
 * and four blocks, a page splits into tabs instead of one long scroll.
 *
 * The open tab lives in the address (`?tab=`), written with the native
 * History API so switching is instant (no server round trip) while reload,
 * back and a shared link still land on the same tab. The first tab is the
 * default and is left out of the address. Desk and phone pass the same keys
 * so a link opens the same tab on either.
 */
export function PageTabs({
  tabs,
  label,
  param = "tab",
}: {
  tabs: PageTab[]
  /** Names the group for a screen reader, e.g. "Overview views". */
  label: string
  param?: string
}) {
  const search = useSearchParams()
  const pathname = usePathname()
  const asked = search.get(param)
  const active = tabs.find((t) => t.key === asked)?.key ?? tabs[0]?.key ?? ""

  const select = (key: string) => {
    const next = new URLSearchParams(search.toString())
    if (key === tabs[0]?.key) next.delete(param)
    else next.set(param, key)
    const qs = next.toString()
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname)
  }

  const open = tabs.find((t) => t.key === active)
  return (
    <div className="cu-pagetabs">
      <Tabs
        label={label}
        active={active}
        items={tabs.map(({ key, label }) => ({ key, label }))}
        onSelect={select}
      />
      <div className="cu-pagetabs__panel" key={active}>
        {open?.content}
      </div>
    </div>
  )
}
