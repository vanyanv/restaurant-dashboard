import { MobileRouteLoading } from "@/components/mobile/mobile-loading"

export default function MobileLaborLoading() {
  return (
    <MobileRouteLoading
      route="/m/labor"
      dept="INTELLIGENCE · § LABOR"
      title="This week's labor"
      toolbar="none"
      cells={3}
      panelTitle="Day by day"
      rows={7}
    />
  )
}
