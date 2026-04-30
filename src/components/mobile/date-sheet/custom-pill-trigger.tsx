"use client"

import dynamic from "next/dynamic"
import { useState } from "react"
import type { Granularity } from "@/lib/pnl"

const MToolbarCustomSheet = dynamic(
  () => import("./m-toolbar-custom-sheet").then((m) => m.MToolbarCustomSheet),
  { ssr: false },
)
const MPnLCustomSheet = dynamic(
  () => import("./m-pnl-custom-sheet").then((m) => m.MPnLCustomSheet),
  { ssr: false },
)

type Props = {
  pathname: string
  searchParams: Record<string, string | undefined>
  variant: "toolbar" | "pnl"
  /** True when `period=custom` is active for this page. */
  isActive: boolean
  /** Short label shown on the pill when active (e.g. "MAR 5 → APR 20"). */
  activeLabel?: string
  initialStart: Date | null
  initialEnd: Date | null
  /** P&L only: granularity from URL (or null if auto). */
  initialGrain?: Granularity | null
}

export function CustomPillTrigger({
  pathname,
  searchParams,
  variant,
  isActive,
  activeLabel,
  initialStart,
  initialEnd,
  initialGrain,
}: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        className={`m-segmented__item${isActive ? " is-active" : ""}`}
        style={{ padding: "10px 6px", fontSize: 9.5 }}
        onClick={() => setOpen(true)}
      >
        {isActive && activeLabel ? activeLabel : "CUSTOM"}
      </button>
      {variant === "toolbar" ? (
        <MToolbarCustomSheet
          open={open}
          onClose={() => setOpen(false)}
          pathname={pathname}
          searchParams={searchParams}
          initialStart={initialStart}
          initialEnd={initialEnd}
        />
      ) : (
        <MPnLCustomSheet
          open={open}
          onClose={() => setOpen(false)}
          pathname={pathname}
          searchParams={searchParams}
          initialStart={initialStart}
          initialEnd={initialEnd}
          initialGrain={initialGrain ?? null}
        />
      )}
    </>
  )
}
