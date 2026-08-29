import { redirect } from "next/navigation"

// A legacy path kept so old links and bookmarks resolve.
//
// It used to redirect to `/dashboard/operations/product-usage?view=costs`,
// from when costs were a URL-param tab on that page. The Counter rebuild of
// product usage has no view parameter — `P.usage` advertises "Menu item
// costs" and "Vendor prices" as tabs, and both were declined there because
// they are built elsewhere and one figure computed twice is what the
// shared-figure rule exists to stop. So the old target silently ignored the
// parameter and showed the usage view.
//
// Menu item costs are `/dashboard/menu-profit`, which is where this now goes.
export default function OperationsCostsPage() {
  redirect("/dashboard/menu-profit")
}
