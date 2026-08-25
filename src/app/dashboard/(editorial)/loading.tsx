import { RoutePageSkeleton } from "@/components/skeletons"

/**
 * Nearest loading boundary for every dashboard route without its own, so it
 * stays shape-agnostic. The Today page composes its own per-section skeletons
 * behind Suspense, so it loses nothing by not having a bespoke fallback here.
 */
export default function DashboardLoading() {
  return <RoutePageSkeleton />
}
