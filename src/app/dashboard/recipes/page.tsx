import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { RecipesShell } from "./components/recipes-shell"

export default async function RecipesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  return <RecipesShell />
}
