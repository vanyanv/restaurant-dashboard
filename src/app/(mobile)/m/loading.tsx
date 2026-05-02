import { MobileRouteLoading } from "@/components/mobile/mobile-loading"

export default function MobileHomeLoading() {
  return (
    <MobileRouteLoading
      route="/m"
      dept="DAILY EDITION"
      title="Loading"
      toolbar="home"
      cells={2}
      chart
      rows={0}
    />
  )
}
