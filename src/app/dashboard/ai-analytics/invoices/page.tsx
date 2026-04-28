import { SubRouteShell } from "../components/shared/sub-route-shell"

export default function AiAnalyticsInvoicesPage(props: {
  searchParams: Promise<{ store?: string }>
}) {
  return (
    <SubRouteShell
      route="INVOICES"
      pageTitle="Invoices"
      cadenceCopy="every six hours at :45 past"
      searchParams={props.searchParams}
    />
  )
}
