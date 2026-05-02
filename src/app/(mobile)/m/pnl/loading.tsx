import { MobileRouteLoading } from "@/components/mobile/mobile-loading"

export default function MobilePnLLoading() {
  return (
    <MobileRouteLoading
      route="/m/pnl"
      dept="P&L"
      title="Profit & Loss"
      toolbar="pnl"
      cells={3}
      panelTitle="By store"
      rows={5}
    />
  )
}
