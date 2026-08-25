import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { MenuCatalogShell } from "./components/menu-catalog-shell"

export default async function MenuCatalogPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  return <MenuCatalogShell />
}
