import { SubRouteShell } from "../components/shared/sub-route-shell"

export default function AiAnalyticsCogsPage(props: {
  searchParams: Promise<{ store?: string }>
}) {
  return (
    <SubRouteShell
      route="COGS"
      pageTitle="COGS"
      cadenceCopy="every four hours at :45 past"
      searchParams={props.searchParams}
    />
  )
}
