import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"

/**
 * The phone's monitoring bridge, gated the same way the desk's is.
 *
 * One rule in two places rather than one place, because the two trees have no
 * common layout: `/dashboard/admin/**` and `/m/monitoring/**` are different
 * route groups under different shells. A gate that held on one surface and not
 * the other would be no gate — the phone is a browser, and the desk URL is one
 * tap away. See `src/app/dashboard/(counter)/admin/layout.tsx` for the whole
 * argument.
 */
export default async function PhoneMonitoringLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/m/login")
  if (session.user.role !== "DEVELOPER") redirect("/m/forbidden")
  return <>{children}</>
}
