"use client"

import { RouteError } from "@/components/dashboard/route-error"

export default function Error(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteError {...props} title="Cost of goods could not load" />
}
