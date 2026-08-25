"use client"

import type { ReactNode } from "react"
import { Rail } from "./rail"
import { Wordmark } from "./wordmark"
import { useEntry } from "@/components/counter/motion/use-entry"

/**
 * The frame every page sits inside: a skip link, the rail in its own
 * 212px column (wordmark above it), an optional topbar slot, and
 * `<main id="ct-main">` holding the page's content.
 *
 * A client component because the rail needs `pathname` to light the
 * current destination and, via `EntryItem` below, pages need `useEntry` —
 * neither is available to a server component.
 */
export function AppShell({
  pathname,
  topbar,
  children,
}: {
  pathname: string
  topbar?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-dvh bg-ct-paper">
      <a
        href="#ct-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-ct-sm focus:bg-ct-ink focus:px-3 focus:py-2 focus:text-ct-mid focus:text-ct-paper"
      >
        Skip to content
      </a>

      <div className="flex w-[212px] shrink-0 flex-col border-r border-ct-line bg-ct-chrome">
        <div className="p-2.5">
          <Wordmark />
        </div>
        <Rail pathname={pathname} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {topbar}
        <main id="ct-main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  )
}

/**
 * `Section` — the sole renderer of `SectionData`'s six states — is
 * deliberately NOT a client component (see its own doc comment). If it
 * called `useEntry` itself it would become one, and every page's data
 * rendering would be dragged to the client with it, just for an entrance
 * animation. So the shell owns the entry index instead, and `EntryItem` is
 * a thin client wrapper around it: a page (a server component) renders
 * `<EntryItem index={i}><Section .../></EntryItem>`, and only this wrapper
 * — not the `Section` inside it — crosses the client boundary.
 */
export function EntryItem({ index, children }: { index: number; children: ReactNode }) {
  const { style } = useEntry(index)
  return (
    <div data-entry-item style={style}>
      {children}
    </div>
  )
}
