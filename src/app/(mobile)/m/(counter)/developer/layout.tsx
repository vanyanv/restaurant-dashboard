import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { canSeeDeveloperPortal } from "@/lib/developer/platform-access"

/**
 * The phone's developer portal, gated the same way the desk's is.
 *
 * `/dashboard/admin/layout.tsx` does not cover `/m/**`: the two trees share
 * no layout, and the desk URL is one tap from the phone one. So the rule is
 * stated again here, as `m/(counter)/monitoring/layout.tsx` does for its
 * pages. The redirect carries nothing about what was refused.
 */
export default async function PhoneDeveloperLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/m/login")
  if (session.user.role !== "DEVELOPER") redirect("/m/forbidden")
  // And a developer of an account the keys do not belong to (`platform-access.ts`).
  if (!canSeeDeveloperPortal(session)) redirect("/m/forbidden")
  return <>{children}</>
}
