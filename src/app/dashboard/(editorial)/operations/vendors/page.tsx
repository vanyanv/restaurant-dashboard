import { redirect } from "next/navigation"

// Vendors consolidated into Product Usage as a URL-param tab. This legacy
// operations path now redirects so existing links and bookmarks resolve.
export default function OperationsVendorsPage() {
  redirect("/dashboard/operations/product-usage?view=vendors")
}
