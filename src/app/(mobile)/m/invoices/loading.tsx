import { MobileRouteLoading } from "@/components/mobile/mobile-loading"

export default function MobileInvoicesLoading() {
  return (
    <MobileRouteLoading
      route="/m/invoices"
      dept="LEDGER"
      title="Invoices"
      cells={2}
      panelTitle="Open ledger"
      rows={6}
    />
  )
}
