"use client"

import dynamic from "next/dynamic"
import { useMemo, useState } from "react"
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
  /** UTC-midnight Date from the URL parser. We normalize to local-time
   *  inside this component so the calendar's local-time comparisons line
   *  up with the user's expected calendar day. */
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

  const localStart = useMemo(() => toLocalMidnight(initialStart), [initialStart])
  const localEnd = useMemo(() => toLocalMidnight(initialEnd), [initialEnd])

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
      {open && variant === "toolbar" && (
        <MToolbarCustomSheet
          open={open}
          onClose={() => setOpen(false)}
          pathname={pathname}
          searchParams={searchParams}
          initialStart={localStart}
          initialEnd={localEnd}
        />
      )}
      {open && variant === "pnl" && (
        <MPnLCustomSheet
          open={open}
          onClose={() => setOpen(false)}
          pathname={pathname}
          searchParams={searchParams}
          initialStart={localStart}
          initialEnd={localEnd}
          initialGrain={initialGrain ?? null}
        />
      )}
    </>
  )
}

/** UTC-midnight Date (from `startOfDayLA`) → local-midnight Date with the
 *  same calendar Y/M/D, so calendar cells (which are constructed via
 *  `new Date(year, m, day)`, i.e. local) compare correctly. */
function toLocalMidnight(d: Date | null): Date | null {
  if (!d) return null
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}
