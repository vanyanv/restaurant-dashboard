"use client"

import { createContext, useContext } from "react"

/**
 * Task 4 of the streaming-architecture plan — the shared half of `stale`.
 *
 * A filter, range, store or search change writes through `writeCounterParams`
 * from one of two places: the layout's own shell (`AppShell`'s store switcher;
 * `PhoneShell`'s `MTop` and `MDateSheet`, which carry BOTH the phone's date
 * control and its store picker) or a page's own controls (`DateControl` inside
 * `PageHead`, the orders filter bar). Whichever one fires, the same
 * `<Section>`s below need to know a refetch is running — a store change from
 * the rail is exactly as much "the figures below are not current" as a range
 * change from the page head, and the design's table
 * (`docs/superpowers/specs/2026-08-26-counter-streaming-architecture-design.md`)
 * does not distinguish the two.
 *
 * So there is exactly ONE `useTransition()` per surface, owned by the shell
 * (`AppShell` on the desk, `PhoneShell` on the phone) — the one component both
 * writers already sit under. It is provided down through `{children}`, the
 * same tree `PageChromeContext` already threads, and:
 *
 *   - the shell's OWN `push` (the store switcher, the phone's date sheet)
 *     wraps its `router.push` in the provided `startTransition` instead of a
 *     second, unrelated one;
 *   - a page's OWN `push` (the desk's `DateControl`, the orders filter bar)
 *     does the same, through `useCounterTransition()`;
 *   - every `<Section>` on the page receives the resulting `pending` boolean,
 *     which `SectionBody` uses to reclassify `ready` into `stale` and
 *     everything with nothing to show into `loading` — see `section.tsx`'s
 *     `pending` prop.
 *
 * `useCounterTransition()` degrades to "never pending, run the scope
 * synchronously" outside a shell — a unit test rendering a page island
 * directly, the same default `usePageChrome` chose for the same reason.
 */
export interface CounterTransition {
  pending: boolean
  /** Runs `scope` inside the ONE transition shared by this surface's shell and every page under it. */
  startTransition: (scope: () => void) => void
}

export const CounterTransitionContext = createContext<CounterTransition | null>(null)

const SYNCHRONOUS: CounterTransition = { pending: false, startTransition: (scope) => scope() }

export function useCounterTransition(): CounterTransition {
  return useContext(CounterTransitionContext) ?? SYNCHRONOUS
}
