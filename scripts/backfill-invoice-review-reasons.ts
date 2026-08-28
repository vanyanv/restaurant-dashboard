// scripts/backfill-invoice-review-reasons.ts
//
// Re-run the invoice sanity rules over every stored invoice and write the
// reasons onto rows that have none.
//
// Why this exists: the rules are applied at sync time, so an invoice that
// synced before a rule was written is never re-examined. On 2026-08-28 the
// account held 226 invoices and five carried a real extraction defect —
// including a $2,691.45 credit memo whose single line was stored twice and a
// $1,474.06 delivery with no lines at all — and all five sat with
// `reviewReasons: null` and a status of MATCHED or APPROVED. No rule had ever
// looked at them.
//
// What it changes:
//   - writes `reviewReasons` wherever the rules now produce some and the row
//     has none
//   - promotes MATCHED / PENDING rows to REVIEW when a reason exists
//
// What it deliberately does NOT change:
//   - APPROVED rows. Someone signed those off. The reason is attached so the
//     detail page can show it, but reverting a human decision is not a
//     backfill's job — the run prints them so an owner can decide.
//   - rows that already carry reasons. Re-deriving over a hand-edited row
//     would overwrite what a person put there.
//
// Run with:
//   npx tsx scripts/backfill-invoice-review-reasons.ts            # dry run
//   npx tsx scripts/backfill-invoice-review-reasons.ts --apply    # persist

import fs from "fs"
import path from "path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue
    const i = t.indexOf("="); if (i === -1) continue
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvLocal()

const APPLY = process.argv.includes("--apply")

async function main() {
  const { prisma } = await import("@/lib/prisma")
  const {
    composeReviewReasons,
    findEmptyExtraction,
    findLineMathMismatches,
    findPackShapeAnomalies,
    findTotalReconciliationMismatch,
  } = await import("@/lib/invoice-sanity")

  const invoices = await prisma.invoice.findMany({
    select: {
      id: true,
      invoiceNumber: true,
      vendorName: true,
      status: true,
      subtotal: true,
      taxAmount: true,
      totalAmount: true,
      matchConfidence: true,
      storeId: true,
      reviewReasons: true,
      lineItems: {
        select: {
          lineNumber: true, sku: true, productName: true, description: true,
          category: true, quantity: true, unit: true, packSize: true,
          unitSize: true, unitSizeUom: true, unitPrice: true, extendedPrice: true,
        },
        orderBy: { lineNumber: "asc" },
      },
    },
    orderBy: { invoiceDate: "desc" },
  })

  console.log(`${invoices.length} invoices, ${APPLY ? "APPLYING" : "dry run"}\n`)

  let flagged = 0, written = 0, promoted = 0, skippedApproved = 0, skippedHasReasons = 0

  for (const inv of invoices) {
    const lineItems = inv.lineItems as never[]
    const extraction = {
      lineItems,
      subtotal: inv.subtotal,
      taxAmount: inv.taxAmount,
      totalAmount: inv.totalAmount,
    }

    const reasons = composeReviewReasons({
      // The sync nulls a suspect date and there is no extraction date to
      // compare against here, so this check is not replayable at backfill
      // time. It is left false rather than guessed.
      dateSuspect: false,
      mathMismatches: findLineMathMismatches(lineItems),
      packAnomalies: findPackShapeAnomalies(lineItems),
      totalMismatch: findTotalReconciliationMismatch(extraction),
      emptyExtraction: findEmptyExtraction(extraction),
      matchConfidence: inv.matchConfidence,
      matched: inv.storeId != null,
    }).filter((r) => r.kind !== "no_store_match" && r.kind !== "low_match_confidence")

    if (reasons.length === 0) continue
    flagged++

    const existing = Array.isArray(inv.reviewReasons) ? inv.reviewReasons.length : 0
    const worth = reasons.map((r) => r.kind).join(", ")
    console.log(`${inv.invoiceNumber.padEnd(12)} ${inv.status.padEnd(9)} ${inv.vendorName}`)
    for (const r of reasons) console.log(`    · ${r.message}`)

    if (existing > 0) { skippedHasReasons++; console.log("    → already carries reasons, left alone\n"); continue }

    const promote = inv.status === "MATCHED" || inv.status === "PENDING"
    if (inv.status === "APPROVED") {
      skippedApproved++
      console.log("    → APPROVED by a person; reason attached, status left as-is\n")
    } else if (promote) {
      console.log(`    → ${inv.status} → REVIEW (${worth})\n`)
    } else {
      console.log(`    → already REVIEW (${worth})\n`)
    }

    if (APPLY) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          reviewReasons: reasons as never,
          ...(promote ? { status: "REVIEW" as const } : {}),
        },
      })
      written++
      if (promote) promoted++
    }
  }

  console.log("─".repeat(60))
  console.log(`flagged ${flagged} · already had reasons ${skippedHasReasons} · APPROVED left alone ${skippedApproved}`)
  console.log(APPLY ? `written ${written} · promoted to REVIEW ${promoted}` : "dry run — nothing written")
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
