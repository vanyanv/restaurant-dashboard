import { MobileRouteLoading } from "@/components/mobile/mobile-loading"

export default function MobileStorePnLLoading() {
  return (
    <MobileRouteLoading
      route="/m/pnl/[storeId]"
      dept="P&L"
      title="Profit & Loss"
      toolbar="pnl"
      cells={3}
      panelTitle="By platform"
      rows={4}
    />
  )
}
