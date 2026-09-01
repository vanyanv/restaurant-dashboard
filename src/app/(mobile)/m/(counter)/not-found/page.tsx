import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { CounterPhoneNotFoundClient } from "./counter-phone-not-found-client"

export const dynamic = "force-dynamic"

/** `/m/not-found` — `P.notfound.phone()`, at a real address for the same reason the desk's is. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  return (
    <>
      <CounterPhoneNotFoundClient />
      <span hidden data-perf-ready="/m/not-found" />
    </>
  )
}
