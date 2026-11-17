"use client"

import { RouteFailed } from "@/components/counter"

/**
 * The `/m` error view for routes outside the `(counter)` group (sign-in and
 * the redirect shims). It renders under `(mobile)/m/layout.tsx`, outside
 * `PhoneShell`, so — like `not-found.tsx` beside it — it opens its own Counter
 * root around nothing but Counter markup. It used to draw the editorial
 * `PageHead` + `Panel`, which was the last reason every phone page downloaded
 * the editorial stylesheets.
 */
export default function MobileError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div data-perf-ready="/m/error" className="ct-root ct-phone">
      <div className="mscroll">
        <RouteFailed {...props} title="This page" />
      </div>
    </div>
  )
}
