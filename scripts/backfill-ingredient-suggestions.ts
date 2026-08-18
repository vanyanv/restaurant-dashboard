// One-shot backfill: give the review inbox's backlog its pre-filled picks.
//
// The auto-match ladder only runs on invoices as they sync (see
// src/app/api/invoices/sync/route.ts). Every unmatched line older than the
// rollout has therefore never been scanned, so its review card arrives with
// no suggestion and the owner picks from the full canonical list by hand —
// on 2026-08-18 that was all 14 groups in the queue, $3,612 of spend.
//
// This runs the ladder in SHADOW mode over the invoices that still hold
// unmatched lines. Shadow writes exactly two things and nothing else:
//   - SUGGESTED decisions, which pre-fill the review inbox's match picker
//   - SHADOW decisions, the "would have linked" audit trail on
//     /dashboard/admin/monitoring/ingredient-audit
// No line item is linked, no vendor/sku alias is learned, no canonical cost
// is recomputed. It cannot change a number on the dashboard.
//
// Run with:
//   ./node_modules/.bin/tsx scripts/backfill-ingredient-suggestions.ts          # dry run
//   ./node_modules/.bin/tsx scripts/backfill-ingredient-suggestions.ts --apply  # writes decisions

import { loadEnvLocal } from "./audit/lib"

loadEnvLocal()

type UnmatchedInvoiceRow = {
  invoiceId: string
  vendorName: string
  invoiceDate: Date | null
  unmatchedLines: number
  unmatchedSpend: number | null
}

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { autoResolveUnmatchedLines } = await import("../src/lib/ingredient-auto-match")
  const { resolveAutoMatchMode } = await import("../src/lib/ingredient-auto-match-core")

  const apply = process.argv.includes("--apply")

  // The ladder's own gate governs the sync path, not this script: a backlog
  // pass is shadow-only by construction. Reported so the operator can see
  // that running this does not depend on, or change, the rollout flag.
  const gate = resolveAutoMatchMode(process.env.INGREDIENT_AUTO_MATCH)

  const account = await prisma.account.findFirst({ select: { id: true, name: true } })
  if (!account) throw new Error("No account found")

  const owner = await prisma.user.findFirst({
    where: { accountId: account.id, role: "OWNER" },
    select: { id: true, email: true },
  })
  if (!owner) throw new Error(`No OWNER user on account ${account.name}`)

  const rows = await prisma.$queryRawUnsafe<UnmatchedInvoiceRow[]>(
    `SELECT i.id                       AS "invoiceId",
            i."vendorName"             AS "vendorName",
            i."invoiceDate"            AS "invoiceDate",
            COUNT(*)::int              AS "unmatchedLines",
            SUM(li."extendedPrice")    AS "unmatchedSpend"
     FROM "InvoiceLineItem" li
     JOIN "Invoice" i ON i.id = li."invoiceId"
     WHERE i."accountId" = $1
       AND li."canonicalIngredientId" IS NULL
     GROUP BY i.id, i."vendorName", i."invoiceDate"
     ORDER BY i."invoiceDate" ASC NULLS LAST`,
    account.id
  )

  const num = (v: unknown): number =>
    v == null ? 0 : typeof v === "number" ? v : Number(String(v))

  const totalLines = rows.reduce((s, r) => s + r.unmatchedLines, 0)
  const totalSpend = rows.reduce((s, r) => s + num(r.unmatchedSpend), 0)
  const oldest = rows.find((r) => r.invoiceDate)?.invoiceDate
  const newest = [...rows].reverse().find((r) => r.invoiceDate)?.invoiceDate
  const day = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? "—"

  console.log(`account:          ${account.name}`)
  console.log(`owner:            ${owner.email}`)
  console.log(`INGREDIENT_AUTO_MATCH gate: ${gate} (this pass runs shadow regardless)`)
  console.log(
    `to scan:          ${rows.length} invoice(s), ${totalLines} unmatched line(s), ` +
      `$${totalSpend.toFixed(0)}, ${day(oldest)} → ${day(newest)}`
  )

  if (rows.length === 0) {
    console.log("\nNothing to do — no invoice holds an unmatched line.")
    return
  }

  if (!apply) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to record suggestions.")
    console.log("Writes on --apply: SUGGESTED pre-fills + SHADOW audit rows only.")
    console.log("Never writes: canonical links, vendor/sku aliases, cost recomputes.")
    return
  }

  console.log("\nRunning the ladder in shadow mode…")
  const result = await autoResolveUnmatchedLines(
    { accountId: account.id, ownerId: owner.id },
    rows.map((r) => r.invoiceId),
    { mode: "shadow" }
  )

  console.log(
    `\nscanned ${result.scanned} group(s): ` +
      `${result.autoExact} exact, ${result.autoVector} vector, ${result.autoLlm} llm ` +
      `(would have linked — nothing was linked)`
  )
  console.log(
    `${result.leftForReview} left for review, of which ${result.suggested} now carry a ` +
      `pre-filled pick; ${result.failed} failed; ${result.llmCalls} LLM call(s)`
  )
  console.log(
    "\nReview them at /dashboard/ingredients (pre-fills) and " +
      "/dashboard/admin/monitoring/ingredient-audit (the would-have-linked log)."
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/prisma")
    await prisma.$disconnect()
  })
