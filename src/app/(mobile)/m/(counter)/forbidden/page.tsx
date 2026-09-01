import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { CounterPhoneForbiddenClient } from "./counter-phone-forbidden-client"

export const dynamic = "force-dynamic"

/** `/m/forbidden` — `P.forbidden.phone()`, at a real address for the same reason the desk's is. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  return (
    <>
      <CounterPhoneForbiddenClient
        roleLabel={session.user.role === "DEVELOPER" ? "Developer" : "Owner"}
      />
      <span hidden data-perf-ready="/m/forbidden" />
    </>
  )
}
