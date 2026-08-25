"use client"

import { useMemo, type ReactNode } from "react"
import { Rail } from "./rail"
import { Wordmark } from "./wordmark"
import { useEntry } from "@/components/counter/motion/use-entry"
import { AskSurface } from "@/components/counter/ask/ask-surface"
import type { AskContext } from "@/lib/counter/ask-context"

/** Stable across renders — a caller that doesn't pass `params` should not
 *  cause `AskSurface` to re-derive context off a fresh object every render. */
const EMPTY_PARAMS = new URLSearchParams()

/**
 * The frame every page sits inside: a skip link, the rail in its own
 * 212px column (wordmark above it), an optional topbar slot, and
 * `<main id="ct-main">` holding the page's content.
 *
 * A client component because the rail needs `pathname` to light the
 * current destination and, via `EntryItem` below, pages need `useEntry` —
 * neither is available to a server component.
 *
 * `AskSurface` is mounted here, once, so every Counter page gets ⌘K without
 * opting in (note 46). `params`, `storeName` and `today` are optional with
 * sane defaults — a caller that doesn't pass them still gets a working
 * surface, just one describing "All stores" / "Yesterday" rather than the
 * page's real selection; a page that reads its own URL state should pass
 * these through so the context sentence can't drift from what's on screen
 * (note 43).
 */
export function AppShell({
  pathname,
  params = EMPTY_PARAMS,
  storeName = null,
  today,
  topbar,
  onAsk,
  children,
}: {
  pathname: string
  params?: URLSearchParams
  storeName?: string | null
  today?: Date
  topbar?: ReactNode
  /** Wired up by the plan that gives the surface something to answer with. */
  onAsk?: (question: string, context: AskContext) => void
  children: ReactNode
}) {
  // Same "resolve once, at mount" contract as DateControl's own default —
  // a caller not passing `today` should not get a moving target on every
  // render (see date-control.tsx).
  const resolvedToday = useMemo(() => today ?? new Date(), [today])

  return (
    /*
     * `ct-root` is what switches the ported prototype stylesheet on.
     * `counter-components.css` declares the prototype's unprefixed token names
     * (`--ink`, `--paper`, `--line`, …) as aliases of the `--ct-*` set, scoped
     * to `.ct-root` and the prototype's own roots. Until this class exists on
     * a real element, all 1030 ported rules apply to nothing.
     *
     * It carries the design's base with it — 13px DM Sans, tabular lining
     * figures, `var(--ink)` on `var(--paper)`, and the `fr` container every
     * `@container` rule in the port is written against. That base lives in
     * `counter-components.css`'s own `.ct-root` block, restated there from
     * `.frame`. So this element deliberately declares NO ground, NO ink and NO
     * type of its own: a `bg-`/`text-` utility here would be a second opinion
     * about something the ported stylesheet already decides, which is the
     * drift this whole phase exists to undo.
     *
     * What is NOT ported from `.frame` is its demo-card layout —
     * `display:grid`, a fixed 212px column, a border, a shadow,
     * `min-height:840px`. That element is a page-of-documentation wrapper.
     * The layout below stays ours.
     */
    <div className="ct-root flex min-h-dvh">
      <a
        href="#ct-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-ct-sm focus:bg-ct-ink focus:px-3 focus:py-2 focus:text-ct-mid focus:text-ct-paper"
      >
        Skip to content
      </a>

      {/*
       * `sticky top-0 h-dvh overflow-y-auto`: the rail must stay put while
       * the page underneath it scrolls — see docs/counter/shell-verification.md,
       * "Does the rail fit in one glance at 900px" (five real sections
       * already produce 1435px of content against a 900px viewport, and
       * without this the whole page — rail included — scrolled away).
       * `overflow-y-auto` is a safety net, not the normal case: all
       * seventeen destinations plus five group captions were measured
       * fitting inside a 900px viewport with no internal scrollbar
       * (`nav.scrollHeight === nav.clientHeight`). Don't remove it as
       * "dead" — it's what keeps the rail itself usable if a future group
       * ever pushes past viewport height.
       */}
      <div className="sticky top-0 flex h-dvh w-[212px] shrink-0 flex-col overflow-y-auto border-r border-ct-line bg-ct-chrome">
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

      <AskSurface
        pathname={pathname}
        params={params}
        storeName={storeName}
        today={resolvedToday}
        onSubmit={onAsk}
      />
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
