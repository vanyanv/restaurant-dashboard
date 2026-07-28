import { redirect } from "next/navigation"

// Settings folded into /m/more (profile identity + sign-out live there now).
// Kept as a redirect so old bookmarks/links to /m/settings still land somewhere.
export default function MobileSettingsPage() {
  redirect("/m/more")
}
