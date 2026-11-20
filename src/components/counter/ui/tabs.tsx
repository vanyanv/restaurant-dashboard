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
  useLayoutEffect(() => {
    const el = track.current
    if (!el) return
    const place = () => {
      const on = el.querySelector<HTMLElement>('.cu-tab[aria-pressed="true"],.cu-tab[aria-current="page"]')
      if (!on) {
        delete el.dataset.pill
        return
      }
      el.style.setProperty("--cu-pill-x", `${on.offsetLeft}px`)
      el.style.setProperty("--cu-pill-w", `${on.offsetWidth}px`)
      el.dataset.pill = "on"
    }
    place()
    // The tabs change width with their container (they fill a phone's).
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
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
