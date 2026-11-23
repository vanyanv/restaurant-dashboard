"use client"

import { createContext, useState, type ReactNode } from "react"

/**
 * Sections reveal top to bottom (owner, 2026-11-23: "certain things load
 * before others and it makes it feel like things shift").
 *
 * Every streamed `Section` owns its own Suspense boundary, so before this a
 * section painted the moment ITS figure landed. A quick one sitting under a
 * slow one — Overview's "Where sales came from" under the P&L-backed hero —
 * painted first, at its skeleton's height above, and was then shoved down the
 * page when the slower block above it arrived. Same pattern on every page with
 * more than one streamed section.
 *
 * The fix is React's `SuspenseList revealOrder="forwards"`, which is still
 * experimental-channel only, so this is that rule written by hand: a section
 * shows when its own data AND every streamed section above it on the page have
 * arrived. Anything already on screen therefore never moves; only skeletons
 * further down can. It costs no time overall — the page finishes when its
 * slowest section does, exactly as before — and nothing is fetched later,
 * because every load was already started by the page before render.
 *
 * "Above" is first-render order, which is tree order. Each tab panel gets its
 * own chain (`PageTabs` wraps every panel), so a hidden tab never holds back
 * the open one and a tab opened early does not wait on the others.
 */

type Tracked<T> = Promise<T> & { status?: "pending" | "fulfilled" | "rejected"; value?: T }

export type RevealChain = {
  gate<T>(source: Promise<T>, occurrence: string): Promise<T>
}

/**
 * One chain per page (or per tab panel). Holds no React state: the gated
 * promise is memoised per Section OCCURRENCE (its `useId()`), so a re-render,
 * a Strict Mode double render or a tab switch hands `use()` the same promise
 * again and nothing re-suspends. Keyed by occurrence, not by source, because
 * one promise can feed two sections with another between them (Overview's
 * hero and Needs you both read `plain`, with channels in between); the lower
 * one must still wait for the middle one.
 */
export function createRevealChain(): RevealChain {
  const gated = new Map<string, { source: object; out: Promise<unknown> }>()
  // The last section handed out, settled either way. `null` or settled means
  // nothing above is still waiting.
  let tail: Tracked<unknown> | null = null

  return {
    gate<T>(source: Promise<T>, occurrence: string): Promise<T> {
      const hit = gated.get(occurrence)
      if (hit && hit.source === source) return hit.out as Promise<T>

      const above = tail
      const aboveDone = above === null || above.status === "fulfilled"
      // Nothing above is waiting: hand back the source itself, so React keeps
      // reading the status the flight client already tagged on it and an
      // arrived figure renders without a suspend.
      const out: Promise<T> = aboveDone ? source : (above as Promise<unknown>).then(() => source)
      gated.set(occurrence, { source, out })

      const s = out as Tracked<T>
      if (s.status === "fulfilled" || s.status === "rejected") {
        // Already settled; it holds nothing below back.
        tail = null
      } else {
        // `Promise.resolve` first: the flight client's thenables are not real
        // promises. Their `then` returns undefined and calls back
        // synchronously once settled, so `out.then(...)` cannot be chained.
        const next: Tracked<unknown> = Promise.resolve(out).then(
          () => {
            next.status = "fulfilled"
          },
          () => {
            // A failed section shows its own failed state; it must not keep
            // the rest of the page waiting.
            next.status = "fulfilled"
          },
        )
        tail = next
      }
      return out
    },
  }
}

export const RevealOrderContext = createContext<RevealChain | null>(null)

/**
 * Opens a top-to-bottom chain for the sections inside it. `resetKey` starts a
 * fresh chain (the shells pass the path, so a new page never waits on a
 * section the last page left loading).
 */
export function RevealOrder({ resetKey = "", children }: { resetKey?: string; children: ReactNode }) {
  const [state, setState] = useState(() => ({ key: resetKey, chain: createRevealChain() }))
  let chain = state.chain
  if (state.key !== resetKey) {
    // The "adjust state while rendering" pattern: React re-renders at once
    // with the new chain, before anything commits.
    chain = createRevealChain()
    setState({ key: resetKey, chain })
  }
  return <RevealOrderContext.Provider value={chain}>{children}</RevealOrderContext.Provider>
}

/**
 * The shells' reset key: the path plus the query, minus `tab` (a tab switch is
 * the same page; every panel already has its own chain). A new store or range
 * brings new promises, and starting a fresh chain means none of them waits on
 * a section the previous view left half-loaded.
 */
export function revealKeyFor(pathname: string, params: { toString(): string }): string {
  const q = new URLSearchParams(params.toString())
  q.delete("tab")
  q.sort()
  return `${pathname}?${q.toString()}`
}
