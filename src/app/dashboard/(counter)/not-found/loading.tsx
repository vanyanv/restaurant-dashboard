"use client"

/**
 * The 404's loading boundary.
 *
 * It renders NOTHING, and that is the honest answer rather than a shortcut.
 * `npm run tokens` requires a `loading.tsx` beside every `page.tsx` in a
 * `(counter)` group, because a route without one blocks on its slowest section
 * and the shell arrives late. This page has no sections and awaits no data —
 * only a session check — so there is no skeleton to draw. A `Section` in
 * `loading()` here would be a placeholder for content that never streams.
 */
export default function Loading() {
  return null
}
