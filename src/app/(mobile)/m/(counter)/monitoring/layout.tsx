import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { SubNav } from "@/components/counter"
import { PHONE_MONITORING_TABS } from "@/lib/counter/nav"

/**
 * The phone's monitoring bridge, gated the same way the desk's is.
 *
 * One rule in two places rather than one place, because the two trees have no
 * common layout: `/dashboard/admin/**` and `/m/monitoring/**` are different
 * route groups under different shells. A gate that held on one surface and not
 * the other would be no gate — the phone is a browser, and the desk URL is one
 * tap away. See `src/app/dashboard/(counter)/admin/layout.tsx` for the whole
 * argument.
 *
 * ## And it carries the sub-navigation
 *
 * One `.seg` bar for eight pages, mounted once here rather than in each of
 * the eight clients the way the desk does it. The desk repeats itself because
 * each of its pages was rebuilt on its own; there is no reason to repeat the
 * repetition. It sits above `{children}` inside `PhoneShell`'s `.mscroll`,
 * which is where `phoneFor()` puts a `.seg` in the prototype.
 *
 * Before this, seven of the eight phone monitoring pages could be reached
 * only by typing the URL — `e2e/mobile/reachability.spec.ts` counted them.
 * `.seg` is not a fidelity landmark, so this changes no page's structure.
 */
export default async function PhoneMonitoringLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/m/login")
  if (session.user.role !== "DEVELOPER") redirect("/m/forbidden")
  return (
    <>
      <SubNav items={PHONE_MONITORING_TABS} label="Monitoring" />
      {children}
    </>
  )
}
