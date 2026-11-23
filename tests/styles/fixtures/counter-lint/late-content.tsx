"use client"
import { Suspense } from "react"
import dynamic from "next/dynamic"

// A page opening its own boundary skips the top-to-bottom reveal, and a
// dynamic block that draws nothing while loading pops in later.
const Late = dynamic(() => import("./good"), { loading: () => null })

export function LateContent() {
  return (
    <Suspense fallback={null}>
      <Late />
    </Suspense>
  )
}
