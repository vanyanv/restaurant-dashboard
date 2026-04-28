import { SubRouteShell } from "../components/shared/sub-route-shell"

export default function AiAnalyticsMenuPage(props: {
  searchParams: Promise<{ store?: string }>
}) {
  return (
    <SubRouteShell
      route="MENU"
      pageTitle="Menu"
      cadenceCopy="every four hours at :45 past"
      searchParams={props.searchParams}
    />
  )
}
