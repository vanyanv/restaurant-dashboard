import { Suspense } from "react"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { EditorialTopbar } from "./editorial-topbar"
import { DashboardTopbarControls } from "./dashboard-topbar-controls"
import {
  TopbarLastSync,
  TopbarMobileStoreSwitcher,
  TopbarRangeStamp,
  TopbarSyncButton,
} from "./sections/topbar-bits"

interface DashboardTopbarProps {
  userRole: string
  range: DashboardRange
}

export function DashboardTopbar({ userRole, range }: DashboardTopbarProps) {
  const stamps = (
    <>
      <Suspense fallback={<span className="opacity-40">loading…</span>}>
        <TopbarRangeStamp range={range} />
      </Suspense>
      <span className="inline-block h-[3px] w-[3px] rotate-45 bg-[var(--ink-faint)]" />
      <Suspense fallback={<span className="opacity-40">syncing…</span>}>
        <TopbarLastSync range={range} />
      </Suspense>
    </>
  )

  return (
    <EditorialTopbar section="§ 01" title="Overview" stamps={stamps}>
      <Suspense fallback={null}>
        <TopbarMobileStoreSwitcher range={range} />
      </Suspense>
      {userRole === "OWNER" && (
        <Suspense fallback={null}>
          <TopbarSyncButton range={range} />
        </Suspense>
      )}
      <DashboardTopbarControls range={range} />
    </EditorialTopbar>
  )
}
