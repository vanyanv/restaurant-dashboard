"use client"

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react"

/**
 * The three chrome facts a Counter page knows and the layout cannot.
 *
 * The chrome moved into `src/app/dashboard/(counter)/layout.tsx` and
 * `src/app/(mobile)/m/(counter)/layout.tsx` because it is URL-driven: the
 * store switcher and the date control both read `readCounterParams` and write
 * `writeCounterParams`, so hoisted into a layout they read the URL and push
 * their own changes and the callback props disappear rather than relocating.
 *
 * WHAT IS LEFT OVER, and it is little. Everything a ROUTE STRING can answer is
 * answered by `src/lib/counter/route-shape.ts` instead — whether the page has
 * a window, and where "pick a store" goes on a page that does not — because a
 * route string is known on the server, during the first render. What remains
 * is what only a page's own DATA knows, and all of it belongs to
 * `/dashboard/orders/<id>`, the one Counter route whose subject is a record
 * rather than a window over a store:
 *
 *   - `leaf` — the breadcrumb's last step. `Topbar` defaults it to the owning
 *     nav destination's label, which is right for a top-level page and reads
 *     "Orders / Orders" on a detail route. The record's own name is the page's
 *     to supply ("Order #4821"), and it comes out of an adapter.
 *   - `storeName` / `storeId` — one order belongs to ONE store, read off the
 *     Platform section by label so the rail cannot name a different store than
 *     the section below it. There is no `?store=` on that route to read it
 *     from.
 *   - `askSuggestions` — the ⌘K palette's "Ask about {page}" group is the
 *     page's own three questions. It is only ever read with the palette open,
 *     so nothing about it is visible on a first paint.
 *
 * PUBLISHED IN AN EFFECT, and that is a deliberate, bounded cost. A page sits
 * BELOW the layout in the tree, so it cannot hand a value upward during
 * render; the first paint therefore carries the layout's own defaults and the
 * override lands on hydration. What that can move is confined to the topbar's
 * crumb text, the rail's selected store and the phone's `.mtop` store label —
 * all of them outside `#ct-main`, which is the surface `npm run fidelity`
 * measures, and none of them a landmark class. Everything a reader reads as
 * the page is under `#ct-main`, rendered by the page itself, in one pass.
 */
export interface PageChrome {
  /** What the breadcrumb calls this page. Defaults to the nav destination's label. */
  leaf?: string
  /** The store the page is scoped to, when the URL is not what scopes it. */
  storeName?: string | null
  /** The store the rail should show as picked, when the URL does not say. */
  storeId?: string | null
  /** The page's own suggested questions — the palette's "Ask about {page}" group. */
  askSuggestions?: string[]
}

/**
 * The setter the shell hands down. `null` outside a shell — `usePageChrome`
 * then does nothing, which is what a unit test rendering a page island on its
 * own wants.
 */
export const PageChromeContext = createContext<Dispatch<SetStateAction<PageChrome>> | null>(null)

/** Stable empty object, so the reset below never publishes a fresh one. */
const NONE: PageChrome = {}

/**
 * A page publishes its chrome overrides. Call it once, at the top of a page's
 * client island; everything is optional, and an omitted field falls back to
 * what the layout derives from the URL.
 *
 * `askSuggestions` is depended on by CONTENT rather than identity, so a page
 * can pass an array literal without looping.
 */
export function usePageChrome(chrome: PageChrome): void {
  const publish = useContext(PageChromeContext)
  const { leaf, storeName, storeId, askSuggestions } = chrome

  // The array is read through a ref and keyed by its content, so a page that
  // writes its three questions as a literal does not republish every render.
  const key = askSuggestions === undefined ? "" : JSON.stringify(askSuggestions)
  const latest = useRef(askSuggestions)
  latest.current = askSuggestions

  useEffect(() => {
    if (publish === null) return
    publish({
      leaf,
      storeName,
      storeId,
      askSuggestions: latest.current,
    })
    return () => publish(NONE)
  }, [publish, leaf, storeName, storeId, key])
}
