"use client"

import type { ReactNode } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Tabs } from "./tabs"

export type PageTab = {
  key: string
  label: string
  content: ReactNode
}

/**
 * A page split into tabs — DESIGN.md "Page layout" rule 2: past the answer
 * and four blocks, a page splits into tabs instead of one long scroll.
 *
 * The open tab lives in the address (`?tab=`), written with the native
 * History API so switching is instant (no server round trip) while reload,
 * back and a shared link still land on the same tab. The default tab (the
 * first, or `initial`) is left out of the address. Desk and phone pass the same keys
 * so a link opens the same tab on either.
 */
export function PageTabs({
  tabs,
  label,
  param = "tab",
  initial,
}: {
  tabs: PageTab[]
  /** Names the group for a screen reader, e.g. "Overview views". */
  label: string
  param?: string
  /** The tab open when the address names none; the first tab if left out. */
  initial?: string
}) {
  const search = useSearchParams()
  const pathname = usePathname()
  const asked = search.get(param)
  const fallback = tabs.find((t) => t.key === initial)?.key ?? tabs[0]?.key ?? ""
  const active = tabs.find((t) => t.key === asked)?.key ?? fallback

  const select = (key: string) => {
    const next = new URLSearchParams(search.toString())
    if (key === fallback) next.delete(param)
    else next.set(param, key)
    const qs = next.toString()
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname)
  }

  // One tab is no choice: draw its content without a row to pick from.
  if (tabs.length === 1) return <div className="cu-pagetabs">{tabs[0].content}</div>
  // Every panel is drawn and the closed ones are `hidden`, the way a closed
  // fold's content was: the sections stream in once, a switch is instant and
  // keeps any half-typed input, and find-in-page still reaches every figure.
  return (
    <div className="cu-pagetabs">
      <Tabs
        label={label}
        active={active}
        items={tabs.map(({ key, label }) => ({ key, label }))}
        onSelect={select}
      />
      {tabs.map((t) => (
        <div key={t.key} className="cu-pagetabs__panel" data-tab={t.key} hidden={t.key !== active}>
          {t.content}
        </div>
      ))}
    </div>
  )
}

/**
 * Opens a tab from outside the tab row — an "Edit" button in the summary that
 * opens the editor tab, say — and scrolls the tabs into view.
 */
export function openTab(key: string, param = "tab") {
  const url = new URL(window.location.href)
  url.searchParams.set(param, key)
  window.history.replaceState(null, "", `${url.pathname}${url.search}`)
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  document.querySelector(".cu-pagetabs")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
}
