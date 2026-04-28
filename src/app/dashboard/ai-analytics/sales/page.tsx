import { SubRouteShell } from "../components/shared/sub-route-shell"

export default function AiAnalyticsSalesPage(props: {
  searchParams: Promise<{ store?: string }>
}) {
  return (
    <SubRouteShell
      route="SALES"
      pageTitle="Sales"
      cadenceCopy="every two hours at :45 past"
      searchParams={props.searchParams}
    />
  )
}
