"use client"

import { useId, useMemo, type ReactNode } from "react"
import { Rail, type RailUser } from "./rail"
import { PageHead } from "./page-head"
import { Topbar } from "./topbar"
import type { SyncState } from "./sync-chip"
import type { SwitchableStore } from "./store-switcher"
import { useEntry } from "@/components/counter/motion/use-entry"
import { AskSurface } from "@/components/counter/ask/ask-surface"
import type { AskContext } from "@/lib/counter/ask-context"
import type { PresetId, RangeId } from "@/lib/counter/date-range"

/** Stable across renders — a caller that doesn't pass `params` should not
 *  cause `AskSurface` to re-derive context off a fresh object every render. */
const EMPTY_PARAMS = new URLSearchParams()

/**
 * The frame every page sits inside, as `deskFor()` builds it (prototype line
 * 8715):
 *
 * ```
 * .frame
 *   aside.rail                 ← logo, STORE SWITCHER, nav groups, account
 *   .app
 *     .topbar                  ← crumbs · spacer · sync · ask. Nothing else.
 *     .appwrap .screenwrap
 *       section.screen
 *         .pagehead            ← h2 title · p.sub · .phactions(date control)
 *         {page content}
 *       cmdk
 * ```
 *
 * Task 5 corrected three structural mistakes here, none of them cosmetic:
 * the store switcher moved from the topbar INTO the rail; the page title,
 * subtitle and date control moved from the topbar INTO `.pagehead`, which is
 * inside the scrolling screen; and the topbar was reduced to the three things
 * the design puts in it.
 *
 * HOW THIS PAGE SCROLLS, and why there is no `sticky` anywhere. The prototype's
 * rail is not sticky and never was — `.appwrap` is `flex:1;min-height:0` and
 * `.screenwrap` is `overflow-y:auto`, so the SCREEN scrolls inside a frame that
 * is exactly as tall as its container while the rail and the topbar stay put by
 * construction. All of that is already in the ported sheet. The only thing it
 * needs from this component is a root with a definite height, which is the
 * `h-dvh` below.
 *
 * `.frame`'s own class is deliberately NOT used. It carries the prototype's
 * demo-card decoration — a border, a 12px radius, a shadow and
 * `min-height:840px` — because in the prototype it is a card on a
 * documentation page. `.ct-root` (counter-components.css) restates only the
 * parts that are the design: the token aliases, the 13px tabular DM Sans base,
 * the ink and ground, and the `container-name: fr` every `@container` rule in
 * the port is written against. The two-column layout is restated here, in the
 * one utility that has no ported equivalent to fight with.
 *
 * `AskSurface` is mounted once, here, so every Counter page gets ⌘K without
 * opting in (note 46). The topbar's own "Ask the numbers" button reaches it
 * through the same delegated `[data-askabout]` listener every `.askmini` uses.
 */
export function AppShell({
  pathname,
  params = EMPTY_PARAMS,
  title,
  sub,
  crumbLeaf,
  actions,
  stores,
  selectedStoreId = null,
  onSelectStore,
  storeName = null,
  user,
  sync,
  today,
  presetId,
  onSelectPreset,
  askSuggestions,
  onAsk,
  children,
}: {
  pathname: string
  params?: URLSearchParams
  /** The page head's own sentence — "7 days to Aug 21", not "Overview". */
  title: string
  /** "HOLLYWOOD · AUG 15 – 21, 2026 · VS THE SAME 4 WEEKDAYS" — the caps are CSS. */
  sub?: string
  /** What the breadcrumb calls this page; defaults to the rail destination's label. */
  crumbLeaf?: string
  /** `.phactions` — the date control, and any view tabs before it. */
  actions?: ReactNode
  stores?: SwitchableStore[]
  selectedStoreId?: string | null
  onSelectStore?: (id: string | null) => void
  /** The selected store's name, for the breadcrumb and the Ask context sentence. */
  storeName?: string | null
  user?: RailUser
  sync?: { state: SyncState; at?: Date; now: Date }
  today?: Date
  /**
   * The current range preset and the way to change it. `AskSurface` draws the
   * prototype's "Change the range" group from these; without `onSelectPreset`
   * it draws no such group, because a palette row that changes nothing is the
   * defect note 46 names.
   */
  presetId?: RangeId
  onSelectPreset?: (id: PresetId) => void
  /** The page's own suggested questions — the palette's "Ask about {page}" group. */
  askSuggestions?: string[]
  /** Wired up by the plan that gives the surface something to answer with. */
  onAsk?: (question: string, context: AskContext) => void
  children: ReactNode
}) {
  // Same "resolve once, at mount" contract as DateControl's own default — a
  // caller not passing `today` should not get a moving target on every render.
  const resolvedToday = useMemo(() => today ?? new Date(), [today])
  const titleId = useId()

  return (
    // `minmax(0,1fr)`, never `1fr`: a bare `1fr` is `minmax(auto,1fr)`, whose
    // minimum is the track's MIN-CONTENT — so at 390px the content column
    // refuses to shrink past the widest thing in it and the whole document
    // scrolls sideways, rail and all. Measured at 390 before the fix. Every
    // element inside is already `min-width:0` in the ported sheet (`.app`,
    // `.screenwrap`, `.screen`, `.sec`), and `.tblscroll` scrolls its own
    // table; this is the one track that was not.
    // `grid-rows-[minmax(0,1fr)]` is not decoration either: with only an
    // implicit row, the row is `auto` — max-content — so a rail 1691px tall at
    // 390px simply grew past `h-dvh` and was clipped, and `.rail{overflow-y:auto}`
    // never engaged because the rail had no definite height to scroll inside.
    // Measured, both viewports.
    //
    // The `max-[900px]` pair MIRRORS a rule in the ported sheet, and has to.
    // `@media (max-width:900px)` (counter-components.css:335) flattens the rail
    // into a horizontal strip — `.rail{flex-direction:row}`,
    // `.rail__cap,.rail__store,.rail__foot{display:none}`,
    // `.appwrap{flex-direction:column}` — and pairs that with
    // `.frame{grid-template-columns:1fr}`. Only the `.frame` half of that pair
    // cannot reach us, because this element deliberately does not carry
    // `.frame` (it would bring a demo card's border, radius, shadow and
    // `min-height:840px` with it). Without the mirror, half the collapse
    // applied and half did not: measured at 390, the rail stayed a 212px
    // sidebar holding a row-flex nav whose store switcher had been hidden by
    // the sheet. Two breakpoints, one number, and the number is the sheet's.
    <div className="ct-root grid h-dvh grid-cols-[212px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden max-[900px]:grid-cols-[minmax(0,1fr)] max-[900px]:grid-rows-[auto_minmax(0,1fr)]">
      <a
        href="#ct-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-ct-sm focus:bg-ct-ink focus:px-3 focus:py-2 focus:text-ct-mid focus:text-ct-paper"
      >
        Skip to content
      </a>

      <Rail
        pathname={pathname}
        stores={stores}
        selectedStoreId={selectedStoreId}
        onSelectStore={onSelectStore}
        user={user}
      />

      <div className="app">
        <Topbar
          pathname={pathname}
          // `crumbs()` always opens with a store, and the prototype's own store
          // list carries an "All stores" pseudo-store for exactly this. A page
          // with no store list at all (`stores` omitted) starts its trail at
          // the page instead of naming an aggregate it does not have.
          storeName={storeName ?? (stores ? "All stores" : undefined)}
          leaf={crumbLeaf}
          sync={sync}
        />

        <div className="appwrap">
          <div className="screenwrap">
            {/*
             * `.screen` IS `<main>`. The prototype's own `<section class="screen">`
             * is the page — everything above it is chrome — and `#ct-main` is
             * what the fidelity harness extracts from, so the two have to be
             * the same element or the gate compares a different tree than the
             * design specifies (ruling F-R5: fix the composition, not the root).
             *
             * `aria-labelledby` the page head's own `<h2>`: the heading LEVEL
             * belongs to `.pagehead h2`, which is the selector that styles it,
             * so the landmark carries the naming instead.
             */}
            <main id="ct-main" className="screen" aria-labelledby={titleId}>
              <PageHead id={titleId} title={title} sub={sub}>
                {actions}
              </PageHead>
              {children}
            </main>
          </div>
        </div>

        {/*
         * Mounted here, but it PORTALS to `document.body` — see its own doc
         * comment for the measurements. Its position in this tree decides
         * nothing about where it paints; what it decides is that every Counter
         * page gets ⌘K without opting in (note 46).
         *
         * The store list and the range preset are handed straight through, so
         * the palette offers exactly what the rail and the date control offer
         * and cannot drift from either.
         */}
        <AskSurface
          pathname={pathname}
          params={params}
          storeName={storeName}
          today={resolvedToday}
          stores={stores}
          selectedStoreId={selectedStoreId}
          onSelectStore={onSelectStore}
          presetId={presetId}
          onSelectPreset={onSelectPreset}
          suggestions={askSuggestions}
          onSubmit={onAsk}
        />
      </div>
    </div>
  )
}

/**
 * `Section` — the sole renderer of `SectionData`'s six states — is
 * deliberately NOT a client component (see its own doc comment). If it called
 * `useEntry` itself it would become one, and every page's data rendering would
 * be dragged to the client with it, just for an entrance animation. So this is
 * a thin client wrapper around the hook instead.
 *
 * IT IS NO LONGER USED BY OVERVIEW, and probably should not be used by any
 * Counter page: the ported sheet already orchestrates the same entrance in CSS
 * — `.screen > *{animation:cnter .34s …}` with per-child delays and its own
 * `prefers-reduced-motion` branch (counter-components.css:780–787, 960). An
 * `EntryItem` inside `.screen` both duplicates that and beats it, because
 * inline animation longhands outrank a stylesheet's shorthand. It stays
 * exported for a surface that is NOT a `.screen` child.
 */
export function EntryItem({ index, children }: { index: number; children: ReactNode }) {
  const { style } = useEntry(index)
  return (
    <div data-entry-item style={style}>
      {children}
    </div>
  )
}
