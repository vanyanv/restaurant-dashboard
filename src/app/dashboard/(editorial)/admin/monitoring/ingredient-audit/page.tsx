import { notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getIngredientAuditRows } from "@/lib/monitoring/ingredient-audit"
import { listRecentAutoMatches } from "@/app/actions/ingredient-auto-match-actions"
import { IngredientAuditClient } from "./ingredient-audit-client"
import { AutoMatchLog } from "./components/auto-match-log"

export const dynamic = "force-dynamic"

// The decision log used to sit on the owner's pantry, where its scores,
// margins and model reasoning were 356px of diagnostics above the ledger.
// Thirty days rather than seven: here you are reading a rollout, not a week.
const LOG_WINDOW_DAYS = 30

export default async function IngredientAuditPage() {
  const session = await getServerSession(authOptions)
  if (session?.user.role !== "DEVELOPER") notFound()

  const [rows, decisions] = await Promise.all([
    getIngredientAuditRows(session.user.accountId),
    listRecentAutoMatches(LOG_WINDOW_DAYS),
  ])

  return (
    <>
      <AutoMatchLog decisions={decisions} days={LOG_WINDOW_DAYS} />
      <IngredientAuditClient rows={rows} />
    </>
  )
}
