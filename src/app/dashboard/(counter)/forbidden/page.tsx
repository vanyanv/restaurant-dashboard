import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { CounterForbiddenClient } from "./counter-forbidden-client"

export const dynamic = "force-dynamic"

/**
 * `/dashboard/forbidden` — `P.forbidden`, at a real address.
 *
 * A REAL ROUTE for the same reason `/dashboard/not-found` is one: a refusal
 * you can only reach by being refused is a refusal no test can ask for. The
 * `admin` layout redirects here, and this URL renders the same page.
 *
 * It does NOT check that you were actually refused, and that is deliberate.
 * The design's sub is "Signed in as … · Owner", so the page says who you are
 * and nothing about where you were going; a developer who types this address
 * reads the same words as an owner who was sent here. See the client's note on
 * why nothing about the refused page travels with the redirect.
 */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  return (
    <>
      <CounterForbiddenClient
        email={session.user.email ?? ""}
        roleLabel={session.user.role === "DEVELOPER" ? "Developer" : "Owner"}
      />
      <span hidden data-perf-ready="/dashboard/forbidden" />
    </>
  )
}
