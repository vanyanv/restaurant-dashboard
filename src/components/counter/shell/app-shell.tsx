"use client"

import { useCallback, useMemo, useState, useTransition, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Rail, type RailUser } from "./rail"
import { PAGE_TITLE_ID } from "./page-head"
import { Topbar } from "./topbar"
import { PageChromeContext, type PageChrome } from "./page-chrome"
import { CounterTransitionContext, type CounterTransition } from "./counter-transition"
import type { SyncState } from "./sync-chip"
import type { SwitchableStore } from "./store-switcher"
import { useEntry } from "@/components/counter/motion/use-entry"
import { AskSurface } from "@/components/counter/ask/ask-surface"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { hasWindow, storeScopeHref } from "@/lib/counter/route-shape"
import type { PresetId } from "@/lib/counter/date-range"

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
 * ---------------------------------------------------------------------------
 * THIS IS MOUNTED BY A LAYOUT, NOT BY A PAGE
 * ---------------------------------------------------------------------------
 *
 * `src/app/dashboard/(counter)/layout.tsx` renders it once around every desk
 * Counter route. It used to be rendered INSIDE each page's client island — 4
 * mount sites, 0 layouts — and a page does not survive a sibling navigation in
 * the App Router while a layout does, so clicking a rail item destroyed and
 * rebuilt the rail, the topbar, the store switcher and the ⌘K surface. From a
 * reader's side that is indistinguishable from a browser reload.
 *
 * WHAT MADE THE MOVE CHEAP: the chrome is already URL-driven. The store
 * switcher and the date control both read `readCounterParams` and write
 * `writeCounterParams` — they were `useSearchParams()` consumers wearing
 * callback props. Here they read the URL and push their own changes, so
 * `pathname`, `params`, `presetId`, `onSelectPreset`, `selectedStoreId` and
 * `onSelectStore` DISAPPEARED from the interface rather than relocating.
 *
 * `PageHead` did not move here with them. The title sentence, the sub-line and
 * the date control are genuinely the page's, they live INSIDE `#ct-main` (the
 * surface `npm run fidelity` measures), and a page renders its own `<PageHead>`
 * as the first of the `children` handed to this shell — which is exactly where
 * this component used to put it, so the rendered DOM under `#ct-main` is
 * unchanged.
 *
 * The four facts a page knows and a URL does not — the breadcrumb leaf, the
 * store an ORDER belongs to, where picking a store should go on a record page,
 * and the palette's own suggestions — arrive through `PageChromeContext`. See
 * `page-chrome.tsx` for why that is an effect and what it can and cannot move.
 *
 * ---------------------------------------------------------------------------
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
  stores,
  user,
  sync,
  today,
  children,
}: {
  stores?: SwitchableStore[]
  user?: RailUser
  sync?: { state: SyncState; at?: Date; now: Date }
  today?: Date
  children: ReactNode
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  // The ONE transition for this surface — see `counter-transition.tsx`. Both
  // this shell's own `push` (the store switcher) and every page's `push`
  // (the date control, the orders filter bar) run through it, so a store
  // change and a range change mark the same `pending` for every `<Section>`.
  const [pending, startTransition] = useTransition()

  // Same "resolve once, at mount" contract as DateControl's own default — a
  // caller not passing `today` should not get a moving target on every render.
  const resolvedToday = useMemo(() => today ?? new Date(), [today])

  /*
   * A real `URLSearchParams`, rebuilt from the hook's read-only one. The desk
   * islands used to receive the query string as PLAIN TEXT across the RSC
   * boundary and reconstruct it for exactly this reason; read here it never
   * crosses a boundary at all, so the class instance is safe.
   */
  const params = useMemo(
    () => new URLSearchParams(searchParams?.toString() ?? ""),
    [searchParams],
  )
  const { presetId, storeId } = useMemo(
    () => readCounterParams(params, resolvedToday),
    [params, resolvedToday],
  )

  const push = useCallback(
    (next: Parameters<typeof writeCounterParams>[1], href = pathname) => {
      const qs = writeCounterParams(params, next).toString()
      // push, not replace: note 19's "a range that only changes the label is a
      // lie" cuts the other way too — a range change is a real navigation an
      // owner expects the back button to undo.
      //
      // Wrapped in `startTransition` so a store change does not blank
      // `#ct-main` back to `loading.tsx` while it resolves — see Task 4 of the
      // streaming-architecture plan. The OLD content stays on screen with
      // `pending` true, which every page's `<Section>` turns into a stale
      // banner over the last good figures.
      startTransition(() => {
        router.push(qs ? `${href}?${qs}` : href, { scroll: false })
      })
    },
    [params, pathname, router, startTransition],
  )

  const [page, setPage] = useState<PageChrome>({})
  const transition = useMemo<CounterTransition>(
    () => ({ pending, startTransition }),
    [pending, startTransition],
  )

  /*
   * On a page scoped by `?store=` this rewrites the current URL. On a RECORD
   * route it goes to that store's list instead — selecting a store cannot
   * re-scope a page about one order, and `storeScopeHref` is where that
   * decision lives now that both order islands no longer write it out.
   */
  const onSelectStore = useCallback(
    (id: string | null) => push({ storeId: id }, storeScopeHref(pathname)),
    [push, pathname],
  )
  const selectedStoreId = page.storeId !== undefined ? page.storeId : storeId
  const storeName =
    page.storeName !== undefined
      ? page.storeName
      : (stores?.find((s) => s.id === storeId)?.name ?? null)

  // A page with no window (an order) draws no "Change the range" group: a
  // palette row that changes nothing is note 46's defect exactly. Read off the
  // route rather than published by the page, so it is right on the first paint.
  const windowed = hasWindow(pathname)
  const onSelectPreset = useCallback((id: PresetId) => push({ presetId: id }), [push])

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
          leaf={page.leaf}
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
             * so the landmark carries the naming instead. The id is a CONSTANT
             * rather than a `useId()` now that the heading is rendered a level
             * down, in the page — one page renders one `PageHead`, and
             * `PageHead` writes this id by default.
             */}
            <main id="ct-main" className="screen" aria-labelledby={PAGE_TITLE_ID}>
              <CounterTransitionContext.Provider value={transition}>
                <PageChromeContext.Provider value={setPage}>{children}</PageChromeContext.Provider>
              </CounterTransitionContext.Provider>
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
          presetId={windowed ? presetId : undefined}
          onSelectPreset={windowed ? onSelectPreset : undefined}
          suggestions={page.askSuggestions}
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
