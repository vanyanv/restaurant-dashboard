import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { RecipesShell } from "./components/recipes-shell"

const VALID_FILTERS = new Set(["unbuilt", "all", "prep", "confirmed"] as const)
type RecipesFilter = "unbuilt" | "all" | "prep" | "confirmed"

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const { filter } = await searchParams
  const initialFilter: RecipesFilter | undefined =
    filter && VALID_FILTERS.has(filter as RecipesFilter)
      ? (filter as RecipesFilter)
      : undefined

  return <RecipesShell initialFilter={initialFilter} />
}
