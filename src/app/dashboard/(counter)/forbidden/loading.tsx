"use client"

/**
 * The refusal's loading boundary — nothing, like the 404's.
 *
 * `npm run tokens` requires one beside every `(counter)` `page.tsx` because a
 * route without one blocks on its slowest section. This page has no sections
 * and awaits only a session, so there is no skeleton to draw.
 */
export default function Loading() {
  return null
}
