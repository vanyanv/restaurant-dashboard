"use client"

import { useLayoutEffect, useRef } from "react"
import Link from "next/link"

export type TabItem = { key: string; label: string; href?: string }

/**
 * A segmented switch: links when each tab is a route, buttons when it is
 * local state. Fills the width on a phone-width container.
 *
 * The highlight is one pill that slides to the picked tab (transform only;
 * its width is set, not animated). It is measured after the first paint, so
 * the server render and a browser without script show the highlight on the
 * tab itself, exactly as before.
 *
 * Shared block: replaces `.seg`, `.pp-tabs`, `.rs-seg`, `.iv-sw`,
 * `.cd-switch` and `.ck-secswitch`. (`MTabs`, the phone's bottom bar, is
 * navigation chrome and stays the shell's.)
 */
export function Tabs({
  items,
  active,
  onSelect,
  label,
}: {
  items: TabItem[]
  active: string
  onSelect?: (key: string) => void
  /** Names the group for a screen reader, e.g. "Period". */
  label: string
}) {
  const track = useRef<HTMLDivElement>(null)
  const shown = useRef<string | null>(null)
  useLayoutEffect(() => {
    const el = track.current
    if (!el) return
    // Which sides have tabs out of view, so the row can fade that edge: on a
    // phone a long row scrolls sideways and nothing else says there is more.
    const edges = () => {
      const more = el.scrollWidth - el.clientWidth
      const start = el.scrollLeft > 4
      const end = el.scrollLeft < more - 4
      if (start || end) el.dataset.more = start && end ? "both" : start ? "start" : "end"
      else delete el.dataset.more
    }
    const place = (bring: "smooth" | "auto" | null) => {
      const on = el.querySelector<HTMLElement>('.cu-tab[aria-pressed="true"],.cu-tab[aria-current="page"]')
      if (!on) {
        delete el.dataset.pill
        edges()
        return
      }
      el.style.setProperty("--cu-pill-x", `${on.offsetLeft}px`)
      el.style.setProperty("--cu-pill-w", `${on.offsetWidth}px`)
      el.dataset.pill = "on"
      // Bring the picked tab to the middle of a row that scrolls, so a link
      // that opens the last tab does not show a row with nothing picked.
      if (bring && el.scrollWidth > el.clientWidth) {
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        el.scrollTo?.({ left: on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2, behavior: reduce ? "auto" : bring })
      }
      edges()
    }
    // Recentre only when the pick moved. A re-render with the same pick (the
    // page passes a new `items` array each time) leaves the row where the
    // owner panned it.
    place(shown.current === null ? "auto" : shown.current !== active ? "smooth" : null)
    shown.current = active
    el.addEventListener("scroll", edges, { passive: true })
    // The tabs change width with their container (they fill a phone's).
    // A row that got narrower may have pushed the picked tab out of view: bring it back, but leave a visible one where it is.
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            const on = el.querySelector<HTMLElement>('.cu-tab[aria-pressed="true"],.cu-tab[aria-current="page"]')
            const hidden = !!on && (on.offsetLeft < el.scrollLeft || on.offsetLeft + on.offsetWidth > el.scrollLeft + el.clientWidth)
            place(hidden ? "auto" : null)
          })
    ro?.observe(el)
    return () => {
      el.removeEventListener("scroll", edges)
      ro?.disconnect()
    }
  }, [active, items])
  return (
    <div className="cu-tabs">
      <div className="cu-tabs__in" role="group" aria-label={label} ref={track}>
        <span className="cu-tabs__pill" aria-hidden />
        {items.map((t) =>
          t.href ? (
            <Link
              key={t.key}
              href={t.href}
              className="cu-tab"
              aria-current={t.key === active ? "page" : undefined}
            >
              {t.label}
            </Link>
          ) : (
            <button
              key={t.key}
              type="button"
              className="cu-tab"
              aria-pressed={t.key === active}
              onClick={() => onSelect?.(t.key)}
            >
              {t.label}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
