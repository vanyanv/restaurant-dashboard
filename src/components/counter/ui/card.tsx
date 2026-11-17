import type { ReactNode } from "react"

/**
 * A surface that sets one thing apart from the page.
 *
 * Shared block: replaces `.pl-card`, `.iv-card`, `.iv-tile`, `.mi-card`,
 * `.sh-tile` and `.ck-tile`.
 *
 * ## Containment
 * The card is `contain: layout`, so a change inside one card (a figure
 * arriving, a row expanding) does not make the browser re-lay-out the rest
 * of the page. It is deliberately NOT `paint`: paint containment clips
 * anything drawn outside the card, and menus, tooltips and the date picker
 * are meant to overflow. Layout containment does make the card the
 * containing block for `position: fixed` children, so a sheet or popover
 * opened from inside a card must render outside it (as `PhoneSheet` and
 * `DateControl` already do: they are mounted by the shell, not the card).
 * `tests/components/counter/ui.test.tsx` and the /dashboard/blocks page
 * check that an absolutely placed menu still shows past the card's edge.
 */
export function Card({
  children,
  as: Tag = "div",
  className,
}: {
  children: ReactNode
  as?: "div" | "section" | "article" | "li"
  className?: string
}) {
  return <Tag className={`cu-card${className ? ` ${className}` : ""}`}>{children}</Tag>
}
