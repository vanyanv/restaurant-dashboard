import { notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getIngredientAuditRows } from "@/lib/monitoring/ingredient-audit"
import { IngredientAuditClient } from "./ingredient-audit-client"

export const dynamic = "force-dynamic"

export default async function IngredientAuditPage() {
  const session = await getServerSession(authOptions)
  if (session?.user.role !== "DEVELOPER") notFound()

  const rows = await getIngredientAuditRows(session.user.accountId)

  return <IngredientAuditClient rows={rows} />
}
