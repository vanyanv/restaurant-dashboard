// scripts/reverify-review-invoices.ts
//
// Re-run the sync's verification (`verifyInvoice`, `matchInvoiceToStore`)
// over every invoice still held in REVIEW or PENDING, and re-derive every
// invoice-priced ingredient under the price rules of 2026-11-03.
//
// Why this exists: the sync decides an invoice's status once, when it
// arrives. The rules changed on 2026-11-03 — a store is now proved by street
// number + ZIP ("1360E Colorado St" is 1360 E Colorado St), a line whose
// arithmetic or pack shape cannot be checked no longer holds an invoice whose
// total ties out, only verified invoices price an ingredient, and the price
// guard judges a reading against the ingredient's established price rather
// than against older misreads. Invoices that arrived before that, and the
// prices they set, are not re-examined by anything else.
//
// What it changes, with --apply:
//   - REVIEW / PENDING invoices the rules now verify: status → MATCHED, the
//     proved store and confidence, and `reviewReasons` replaced by the line
//     notes (lines kept out of prices), or cleared when there are none.
//   - REVIEW invoices still not verifiable: their reasons are rewritten in the
//     new words; the status stays REVIEW. Nothing is guessed to clear them.
//   - every UNLOCKED ingredient whose price came from invoices
//     (`costSource` null or "invoice"): `costPerRecipeUnit` re-derived from
//     verified lines only. A manual or locked price is never touched.
//
// What it never changes: APPROVED, MATCHED and REJECTED invoices, line items,
// ingredient matches, or any manual price.
//
// Run with (the database in DATABASE_URL — check which one it is first):
//   npx tsx scripts/reverify-review-invoices.ts                       # dry run, every account
//   npx tsx scripts/reverify-review-invoices.ts --apply               # persist
//   npx tsx scripts/reverify-review-invoices.ts --account <accountId> # one account

import fs from "fs"
import path from "path"
import type { Prisma as PrismaTypes } from "@/generated/prisma/client"

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
const accountArg = (() => {
  const i = process.argv.indexOf("--account")
  return i >= 0 ? process.argv[i + 1] : undefined
})()

/** The printed date from the stored extraction, when there is one. */
function printedDate(rawExtractionJson: string | null): string | null {
  if (!rawExtractionJson) return null
  try {
    const parsed = JSON.parse(rawExtractionJson) as { invoiceDate?: unknown }
    return typeof parsed.invoiceDate === "string" ? parsed.invoiceDate : null
  } catch {
    return null
  }
}

async function main() {
  const { prisma } = await import("@/lib/prisma")
  const { Prisma } = await import("@/generated/prisma/client")
  const { matchInvoiceToStore } = await import("@/lib/address-matcher")
  const { verifyInvoice } = await import("@/lib/invoice-verify")
  const { sanitizeInvoiceDate } = await import("@/lib/invoice-sanity")
  const { lineMatchesPrior } = await import("@/lib/invoice-pack-prior")
  const { loadPackShapePriors } = await import("@/lib/invoice-pack-prior-load")
  const { deriveCanonicalCost } = await import("@/lib/ingredient-cost")
  const { bustTags } = await import("@/lib/cache/cached")

  console.log(APPLY ? "APPLY — changes will be written." : "DRY RUN — nothing is written. Pass --apply to persist.")

  const accounts = accountArg
    ? [{ id: accountArg }]
    : await prisma.account.findMany({ select: { id: true } })

  const addressKey = (a: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  let verified = 0
  let stillHeld = 0
  let pricesMoved = 0

  for (const { id: accountId } of accounts) {
    const held = await prisma.invoice.findMany({
      where: { accountId, status: { in: ["REVIEW", "PENDING"] } },
      select: {
        id: true,
        vendorName: true,
        invoiceNumber: true,
        invoiceDate: true,
        emailReceivedAt: true,
        rawExtractionJson: true,
        deliveryAddress: true,
        status: true,
        storeId: true,
        matchConfidence: true,
        subtotal: true,
        taxAmount: true,
        totalAmount: true,
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

    if (held.length > 0) {
      const stores = await prisma.store.findMany({
        where: { accountId, isActive: true },
        select: { id: true, address: true },
      })
      // The same approved-address memory the sync reads.
      const confirmed = new Map<string, string>()
      for (const a of await prisma.invoice.findMany({
        where: { accountId, status: "APPROVED", storeId: { not: null }, deliveryAddress: { not: null } },
        select: { deliveryAddress: true, storeId: true },
        distinct: ["deliveryAddress", "storeId"],
      })) {
        if (a.deliveryAddress && a.storeId) confirmed.set(addressKey(a.deliveryAddress), a.storeId)
      }
      const skus = [...new Set(held.flatMap((i) => i.lineItems.map((l) => l.sku)).filter((s): s is string => !!s))]
      const priors = await loadPackShapePriors(accountId, skus)

      console.log(`\nAccount ${accountId}: ${held.length} held invoice(s)`)
      for (const inv of held) {
        const fuzzy = inv.deliveryAddress ? matchInvoiceToStore(inv.deliveryAddress, stores) : null
        const confirmedStore = inv.deliveryAddress ? confirmed.get(addressKey(inv.deliveryAddress)) : undefined
        const match =
          fuzzy && confirmedStore === fuzzy.storeId && fuzzy.confidence < 0.85
            ? { ...fuzzy, confidence: 1 }
            : fuzzy

        // Date: suspect only when the PDF printed one and it is implausible
        // next to the email's arrival — the sync's own test, re-run.
        const printed = printedDate(inv.rawExtractionJson)
        const dateSuspect =
          printed != null &&
          sanitizeInvoiceDate(printed, inv.emailReceivedAt, `${inv.vendorName} #${inv.invoiceNumber}`) === null

        const verdict = verifyInvoice({
          extraction: {
            lineItems: inv.lineItems,
            subtotal: inv.subtotal,
            taxAmount: inv.taxAmount,
            totalAmount: inv.totalAmount,
          },
          dateSuspect,
          match,
          isPackConfirmed: (li) => lineMatchesPrior(inv.vendorName, li, priors),
        })

        const label =
          `${inv.vendorName} #${inv.invoiceNumber} ` +
          `${inv.invoiceDate?.toISOString().slice(0, 10) ?? "undated"} $${inv.totalAmount.toFixed(2)}`
        const before = Array.isArray(inv.reviewReasons)
          ? (inv.reviewReasons as Array<{ kind?: string }>).map((r) => r.kind).join(", ")
          : "none"
        const after = verdict.reviewReasons.map((r) => r.kind).join(", ") || "none"
        console.log(
          `  ${inv.status} → ${verdict.status}  ${label}\n` +
            `    address: ${inv.deliveryAddress ?? "(none)"} → store ${match?.storeId ?? "none"} ` +
            `@ ${match ? (match.confidence * 100).toFixed(0) + "%" : "-"} (was ${inv.storeId ?? "none"} @ ` +
            `${inv.matchConfidence != null ? (inv.matchConfidence * 100).toFixed(0) + "%" : "-"})\n` +
            `    reasons: [${before}] → [${after}]` +
            (verdict.unpricedLines.length ? `; lines kept out of prices: ${verdict.unpricedLines.join(", ")}` : ""),
        )

        if (verdict.status === "MATCHED") verified++
        else stillHeld++

        if (!APPLY) continue
        await prisma.invoice.update({
          where: { id: inv.id },
          data: {
            status: verdict.status,
            storeId: match?.storeId ?? inv.storeId,
            matchConfidence: match?.confidence ?? inv.matchConfidence,
            matchedAt: match && verdict.status === "MATCHED" ? new Date() : undefined,
            reviewReasons:
              verdict.reviewReasons.length > 0
                ? (verdict.reviewReasons as unknown as PrismaTypes.InputJsonValue)
                : Prisma.DbNull,
          },
        })
      }
    }

    if (!APPLY) {
      console.log(
        "\n(Dry run: the price list below uses invoice statuses as they stand now. " +
          "Invoices this run would verify are not counted yet, so --apply can move more prices than listed.)",
      )
    }

    // Prices: every unlocked, invoice-priced ingredient on the account.
    const canonicals = await prisma.canonicalIngredient.findMany({
      where: {
        accountId,
        costLocked: false,
        recipeUnit: { not: null },
        OR: [{ costSource: null }, { costSource: "invoice" }],
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })
    let header = false
    for (const c of canonicals) {
      const d = await deriveCanonicalCost(c.id)
      if (d.status !== "derived") continue
      const moved =
        d.before == null ? true : Math.abs(d.after - d.before) > Math.max(1e-6, Math.abs(d.before) * 0.01)
      if (!moved) continue
      if (!header) {
        console.log(`\nAccount ${accountId}: ingredient prices that move under the new rules`)
        header = true
      }
      pricesMoved++
      console.log(
        `  ${c.name}: ${d.before != null ? "$" + d.before.toFixed(4) : "none"} → $${d.after.toFixed(4)}/${d.unit}` +
          (d.rejectedSpike ? "  (a newer reading was refused as >5x off the established price)" : ""),
      )
      if (APPLY) {
        await prisma.canonicalIngredient.update({
          where: { id: c.id },
          data: { costPerRecipeUnit: d.after, costSource: "invoice", costUpdatedAt: new Date() },
        })
      }
    }

    if (APPLY) await bustTags(["invoices", "pnl", `account:${accountId}`])
  }

  console.log(
    `\n${verified} invoice(s) ${APPLY ? "verified" : "would be verified"}, ${stillHeld} still held ` +
      `(their prices stay out of recipe costs); ${pricesMoved} ingredient price(s) ${APPLY ? "re-derived" : "would move"}.`,
  )
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
