// scripts/rematch-invoices.ts
// Re-run address matching on invoices that are currently PENDING or REVIEW,
// using whatever deliveryAddress is already stored (no AI calls). Useful after
// tweaking the address matcher to promote previously-borderline rows to MATCHED.
//
// Run with:
//   npx tsx scripts/rematch-invoices.ts              # dry run
//   npx tsx scripts/rematch-invoices.ts --apply      # persist changes

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
  const { prisma } = await import("../src/lib/prisma")
  const { matchInvoiceToStore } = await import("../src/lib/address-matcher")

  console.log(`Mode: ${APPLY ? "APPLY (will update DB)" : "DRY RUN"}\n`)

  // Consider rows whose status might change based on a better match.
  // (MATCHED rows already cleared ≥0.85; APPROVED is a user-set state we don't override.)
  const rows = await prisma.invoice.findMany({
    where: { status: { in: ["PENDING", "REVIEW"] } },
    select: {
      id: true, ownerId: true, vendorName: true, invoiceNumber: true,
      deliveryAddress: true, storeId: true, status: true,
      matchConfidence: true, invoiceDate: true,
    },
  })
  console.log(`Considering ${rows.length} PENDING/REVIEW invoice(s).\n`)
  if (rows.length === 0) return await prisma.$disconnect()

  const ownerIds = Array.from(new Set(rows.map((r) => r.ownerId)))
  const allStores = await prisma.store.findMany({
    where: { ownerId: { in: ownerIds }, isActive: true },
    select: { id: true, address: true, name: true, ownerId: true },
  })
  const storesByOwner = new Map<string, typeof allStores>()
  for (const s of allStores) {
    const arr = storesByOwner.get(s.ownerId) ?? []
    arr.push(s)
    storesByOwner.set(s.ownerId, arr)
  }

  let changed = 0
  for (const r of rows) {
    const ownerStores = storesByOwner.get(r.ownerId) ?? []
    const match = r.deliveryAddress ? matchInvoiceToStore(r.deliveryAddress, ownerStores) : null

    // Preserve current REVIEW if the *reason* for review was a date-sanity flag
    // (i.e. invoiceDate is null). We only promote rows whose REVIEW was match-confidence-driven.
    const dateSuspect = r.invoiceDate === null

    let nextStatus: "MATCHED" | "REVIEW" | "PENDING"
    if (dateSuspect) nextStatus = "REVIEW"
    else if (match) nextStatus = match.confidence >= 0.85 ? "MATCHED" : "REVIEW"
    else nextStatus = "PENDING"

    const matchedStore = match ? ownerStores.find((s) => s.id === match.storeId) : null
    const changedSomething =
      nextStatus !== r.status ||
      (match?.storeId ?? null) !== r.storeId ||
      (match?.confidence ?? null) !== r.matchConfidence

    const addrPreview = r.deliveryAddress?.replace(/\n/g, " / ").slice(0, 60) ?? "null"
    console.log(`[${r.vendorName} #${r.invoiceNumber}]`)
    console.log(`  address:     ${addrPreview}`)
    console.log(`  old status:  ${r.status}  (store ${r.storeId ?? "null"}, conf ${r.matchConfidence?.toFixed(2) ?? "null"})`)
    console.log(`  new status:  ${nextStatus}  (store ${matchedStore?.name ?? match?.storeId ?? "null"}, conf ${match?.confidence.toFixed(2) ?? "null"})`)
    console.log(`  change:      ${changedSomething ? "YES" : "no"}`)
    console.log()

    if (!changedSomething || !APPLY) continue

    await prisma.invoice.update({
      where: { id: r.id },
      data: {
        status: nextStatus,
        storeId: match?.storeId ?? null,
        matchConfidence: match?.confidence ?? null,
        matchedAt: match ? new Date() : null,
      },
    })
    changed++
  }

  console.log(`━━━ ${changed} row(s) updated ${APPLY ? "" : "(dry run — 0 actually written)"} ━━━`)
  if (!APPLY) console.log("Re-run with --apply to persist.")
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
