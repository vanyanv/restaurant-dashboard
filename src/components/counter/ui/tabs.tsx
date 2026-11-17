"use client"

import Link from "next/link"

export type TabItem = { key: string; label: string; href?: string }

/**
 * A segmented switch: links when each tab is a route, buttons when it is
 * local state. Fills the width on a phone-width container.
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
  return (
    <div className="cu-tabs">
      <div className="cu-tabs__in" role="group" aria-label={label}>
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
