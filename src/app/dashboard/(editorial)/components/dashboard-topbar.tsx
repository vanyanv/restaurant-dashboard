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
import type { DashboardPromise } from "./sections/data"

interface DashboardTopbarProps {
  userRole: string
  range: DashboardRange
  dashboardPromise: DashboardPromise
}

export function DashboardTopbar({
  userRole: _userRole,
  range,
  dashboardPromise,
}: DashboardTopbarProps) {
  const stamps = (
    <>
      <Suspense fallback={<span className="opacity-40">loading…</span>}>
        <TopbarRangeStamp dashboardPromise={dashboardPromise} />
      </Suspense>
      <span className="inline-block h-[3px] w-[3px] rotate-45 bg-[var(--ink-faint)]" />
      <Suspense fallback={<span className="opacity-40">syncing…</span>}>
        <TopbarLastSync dashboardPromise={dashboardPromise} />
      </Suspense>
    </>
  )

  return (
    <EditorialTopbar section="§ 01" title="Overview" stamps={stamps}>
      <Suspense fallback={null}>
        <TopbarMobileStoreSwitcher dashboardPromise={dashboardPromise} />
      </Suspense>
      <Suspense fallback={null}>
        <TopbarSyncButton dashboardPromise={dashboardPromise} />
      </Suspense>
      <DashboardTopbarControls range={range} />
    </EditorialTopbar>
  )
}
