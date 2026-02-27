import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getRecipes } from "@/app/actions/product-usage-actions"
import { getStores } from "@/app/actions/store-actions"
import { RecipesContent } from "./components/recipes-content"

export default async function RecipesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/dashboard")

  const [recipes, stores] = await Promise.all([
    getRecipes(),
    getStores(),
  ])

  return (
    <RecipesContent
      initialRecipes={recipes}
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
    />
  )
}
