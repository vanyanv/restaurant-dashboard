"use client"

import { RouteFailed } from "@/components/counter"

/**
 * The boundary for every rebuilt desk route. See `RouteFailed` for why it
 * exists and why it lives inside the group rather than at the root — in
 * short, so `(counter)/layout.tsx` still renders and the reader keeps the
 * rail they need to leave by.
 */
export default function CounterRouteError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteFailed {...props} title="This page" />
}
