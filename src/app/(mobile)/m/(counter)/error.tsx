"use client"

import { RouteFailed } from "@/components/counter"

/**
 * The phone half of the desk boundary beside it. Same component, so the two
 * surfaces cannot drift about what a failed page looks like, and the
 * `(counter)` layout's `PhoneShell` survives — the tab bar still navigates.
 */
export default function CounterPhoneRouteError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteFailed {...props} title="This page" />
}
