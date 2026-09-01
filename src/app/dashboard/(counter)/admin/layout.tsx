import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"

/**
 * `/dashboard/admin/**` is developer-only, and now it actually is.
 *
 * ## Why this exists
 *
 * `P.monitoring`'s sub reads "Developer only · not visible to the owner", and
 * this product rendered that sentence to owners while letting them in. The
 * monitoring page's own docblock argued the gate could not be built —
 * "`Role` holds only OWNER and DEVELOPER and every access helper accepts
 * both" — and that was half right. `hasOwnerAccess` accepts both, so it is the
 * wrong helper; a direct role comparison is not, and three places in this
 * codebase already make it: `/api/monitoring/summary`, the canonical
 * ingredient pack-definition action, and the count page's `canEditDefinition`.
 * The monitoring API is developer-only today. The pages in front of it were
 * not, which is the mismatch rather than the policy.
 *
 * ## What it changes, plainly
 *
 * An OWNER account can no longer open the eight monitoring pages. That is a
 * real restriction on a real person — the owner of this account — and it is
 * what both the design and the API already say should happen. Nothing else
 * moves: no data changes, and a DEVELOPER sees exactly what they saw.
 *
 * ## Why the redirect carries nothing
 *
 * No `?from=`, no return path, no page name. `P.forbidden` says in bold that
 * the page never says what was on it, and a query string naming the refused
 * route would be exactly that leak — visible in a shared screenshot, in a
 * browser history, in a support paste.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "DEVELOPER") redirect("/dashboard/forbidden")
  return <>{children}</>
}
