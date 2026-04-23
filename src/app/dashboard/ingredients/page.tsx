import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { IngredientsShell } from "./components/ingredients-shell"

export default async function IngredientsPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const { open } = await searchParams

  return <IngredientsShell initialOpenId={open ?? null} />
}
