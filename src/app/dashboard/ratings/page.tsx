import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getRatingsAnalytics } from "@/app/actions/ratings-actions"
import { RatingsContent } from "./components/ratings-content"

export default async function RatingsPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect("/login")
  }

  const data = await getRatingsAnalytics(undefined, { days: 21 })

  return (
    <RatingsContent
      initialData={data}
      userRole={session.user.role}
    />
  )
}
