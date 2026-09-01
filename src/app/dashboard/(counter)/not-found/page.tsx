import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { CounterNotFoundClient } from "./counter-not-found-client"

export const dynamic = "force-dynamic"

/**
 * `/dashboard/not-found` — `P.notfound`, at the address the design gives it.
 *
 * A REAL ROUTE as well as a convention file. The prototype names this page
 * `/dashboard/not-found` and the fidelity manifest measures it there, and a
 * `not-found.tsx` alone is reachable only by failing to match something else —
 * which is a thing you cannot ask a test to do reliably inside a route group.
 * `not-found.tsx` beside this renders the same client, so a genuine miss and
 * this URL show one page.
 */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  return (
    <>
      <CounterNotFoundClient />
      <span hidden data-perf-ready="/dashboard/not-found" />
    </>
  )
}
