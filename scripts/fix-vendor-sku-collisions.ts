// One-shot repair for IngredientSkuMatch rows keyed on a raw vendor spelling.
//
// Until 2026-08-18 the learned (vendor, sku) → canonical table was unique on
// the RAW vendorName. `normalizeVendorName` is a display normalizer that lets
// unknown vendors through with their casing intact, so one vendor writing
// "VITCO FOODSERVICE" on some invoice templates and "Vitco Foodservice" on
// others owned two independent mappings for the same SKU. Two failures follow:
//
//   1. Contradictory mappings. Vitco 15725 (the 180x1.5oz sauce cup) was
//      confirmed to the cup canonical under one spelling and to the 4x4LB
//      bulk canonical under the other — $15,119.52 of cup purchases booked
//      against the bulk ingredient.
//   2. Orphaned history. Vitco 15726 only ever had a mixed-case row, so every
//      caps-spelled 15726 invoice missed the lookup and fell into the review
//      queue — 5 lines, $2,971.70.
//
// The schema now keys on `vendorKey` (see src/lib/vendor-normalize.ts). This
// script gets existing data into a state that constraint can accept, and
// repairs the damage the old key already did:
//
//   1. backfill vendorKey on every row
//   2. collapse duplicate rows that agree on the canonical
//   3. resolve conflicting rows (requires an explicit --resolve; never guesses)
//   4. re-point invoice lines whose (vendorKey, sku) now maps elsewhere
//   5. link unmatched lines whose (vendorKey, sku) already has a mapping
//   6. recompute cost for every canonical touched
//
// Steps 1-3 must run BEFORE the migration creates the unique index, or the
// index creation fails on the duplicates. Re-running afterwards is safe.
//
//   ./node_modules/.bin/tsx scripts/fix-vendor-sku-collisions.ts
//   ./node_modules/.bin/tsx scripts/fix-vendor-sku-collisions.ts \
//     --resolve 'vitco foodservice::15725=<canonicalId>' --apply

import { loadEnvLocal } from "./audit/lib"

loadEnvLocal()

const APPLY = process.argv.includes("--apply")

/** --resolve 'vendorKey::sku=canonicalId' (repeatable) */
function parseResolutions(): Map<string, string> {
  const out = new Map<string, string>()
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] !== "--resolve") continue
    const raw = process.argv[i + 1]
    if (!raw) throw new Error("--resolve needs an argument: 'vendorKey::sku=canonicalId'")
    const eq = raw.lastIndexOf("=")
    if (eq < 0) throw new Error(`--resolve malformed (no '='): ${raw}`)
    out.set(raw.slice(0, eq).trim(), raw.slice(eq + 1).trim())
  }
  return out
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { vendorMatchKey, normalizeVendorName } = await import("../src/lib/vendor-normalize")
  const { recomputeCanonicalCost } = await import("../src/lib/ingredient-cost")

  const resolutions = parseResolutions()
  const touchedCanonicals = new Set<string>()

  console.log(APPLY ? "MODE: APPLY (writes)\n" : "MODE: DRY RUN (no writes)\n")

  // The column may not exist yet if the schema push has not run. Add it here
  // so the backfill below can run before the unique index is created.
  if (APPLY) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "IngredientSkuMatch" ADD COLUMN IF NOT EXISTS "vendorKey" TEXT NOT NULL DEFAULT ''`
    )
  }

  // ---------- 1. backfill vendorKey ----------
  // A dry run must work before the column exists, so probe rather than assume.
  const [{ present }] = await prisma.$queryRawUnsafe<{ present: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'IngredientSkuMatch' AND column_name = 'vendorKey'
     ) AS present`
  )
  const keyCol = present ? '"vendorKey"' : `'' AS "vendorKey"`

  const rows = await prisma.$queryRawUnsafe<
    {
      id: string
      ownerId: string
      accountId: string
      vendorName: string
      vendorKey: string
      sku: string
      canonicalIngredientId: string
      confirmedAt: Date
    }[]
  >(
    `SELECT id, "ownerId", "accountId", "vendorName", ${keyCol}, sku,
            "canonicalIngredientId", "confirmedAt"
     FROM "IngredientSkuMatch"`
  )
  const stale = rows.filter((r) => r.vendorKey !== vendorMatchKey(r.vendorName))
  console.log(`1. vendorKey backfill: ${stale.length} of ${rows.length} row(s) need writing`)
  if (APPLY) {
    for (const r of stale) {
      await prisma.$executeRawUnsafe(
        `UPDATE "IngredientSkuMatch" SET "vendorKey" = $1 WHERE id = $2`,
        vendorMatchKey(r.vendorName),
        r.id
      )
    }
  }
  for (const r of rows) r.vendorKey = vendorMatchKey(r.vendorName)

  // ---------- 2/3. collisions ----------
  const byKey = new Map<string, typeof rows>()
  for (const r of rows) {
    const k = `${r.accountId}::${r.vendorKey}::${r.sku}`
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k)!.push(r)
  }
  const collisions = [...byKey.entries()].filter(([, v]) => v.length > 1)

  const deleteIds: string[] = []
  /** vendorKey::sku → the canonical every line for that key should point at. */
  const winners = new Map<string, string>()
  let unresolved = 0

  console.log(`\n2/3. collisions: ${collisions.length} colliding key(s)`)
  for (const [k, group] of collisions) {
    const [, vendorKey, sku] = k.split("::")
    const lookup = `${vendorKey}::${sku}`
    const canonIds = new Set(group.map((r) => r.canonicalIngredientId))

    if (canonIds.size === 1) {
      // Benign: same target, two spellings. Prefer the row already carrying
      // the display spelling — vendorName survives as the human-readable
      // label — and break remaining ties on the earliest confirm.
      const sorted = [...group].sort((a, b) => {
        const aCanon = a.vendorName === normalizeVendorName(a.vendorName) ? 0 : 1
        const bCanon = b.vendorName === normalizeVendorName(b.vendorName) ? 0 : 1
        if (aCanon !== bCanon) return aCanon - bCanon
        return a.confirmedAt.getTime() - b.confirmedAt.getTime()
      })
      const keep = sorted[0]
      const drop = sorted.slice(1)
      deleteIds.push(...drop.map((r) => r.id))
      winners.set(lookup, keep.canonicalIngredientId)
      console.log(
        `   duplicate  ${lookup}: keeping "${keep.vendorName}", dropping ${drop
          .map((r) => `"${r.vendorName}"`)
          .join(", ")} (all → same canonical)`
      )
      continue
    }

    const chosen = resolutions.get(lookup)
    if (!chosen) {
      unresolved++
      console.log(`   CONFLICT   ${lookup}: ${canonIds.size} different canonicals — NO RESOLUTION GIVEN`)
      for (const r of group) {
        console.log(`                "${r.vendorName}" → ${r.canonicalIngredientId} (${r.confirmedAt.toISOString().slice(0, 10)})`)
      }
      console.log(`                pass --resolve '${lookup}=<canonicalId>' to settle it`)
      continue
    }
    if (!group.some((r) => r.canonicalIngredientId === chosen)) {
      throw new Error(`--resolve ${lookup}=${chosen}: no colliding row points at that canonical`)
    }
    const keep = group.find((r) => r.canonicalIngredientId === chosen)!
    const drop = group.filter((r) => r.id !== keep.id)
    deleteIds.push(...drop.map((r) => r.id))
    winners.set(lookup, chosen)
    console.log(`   CONFLICT   ${lookup}: resolved to ${chosen} ("${keep.vendorName}")`)
    console.log(`                dropping ${drop.map((r) => `"${r.vendorName}" → ${r.canonicalIngredientId}`).join(", ")}`)
  }

  if (unresolved > 0) {
    console.log(`\nSTOP: ${unresolved} unresolved conflict(s). Nothing further will run.`)
    console.log("Settle each with --resolve, then re-run.")
    process.exitCode = 1
    return
  }

  if (deleteIds.length > 0 && APPLY) {
    await prisma.ingredientSkuMatch.deleteMany({ where: { id: { in: deleteIds } } })
  }
  console.log(`   ${deleteIds.length} row(s) ${APPLY ? "deleted" : "would be deleted"}`)

  // The mapping table is now one row per (accountId, vendorKey, sku). Rebuild
  // the lookup from the survivors so steps 4/5 agree with what the matcher
  // will see from here on.
  const survivors = rows.filter((r) => !deleteIds.includes(r.id))
  const mapping = new Map<string, string>()
  for (const r of survivors) mapping.set(`${r.accountId}::${r.vendorKey}::${r.sku}`, r.canonicalIngredientId)

  // ---------- 4/5. re-point and link invoice lines ----------
  const skus = [...new Set(survivors.map((r) => r.sku))]
  const lines = await prisma.invoiceLineItem.findMany({
    where: { sku: { in: skus } },
    select: {
      id: true,
      sku: true,
      extendedPrice: true,
      canonicalIngredientId: true,
      invoice: { select: { accountId: true, vendorName: true, invoiceDate: true } },
    },
  })

  type Move = { ids: string[]; spend: number; from: string; to: string; sku: string; vendorKey: string }
  const repoint = new Map<string, Move>()
  const link = new Map<string, Move>()

  for (const l of lines) {
    if (!l.sku) continue
    const vk = vendorMatchKey(l.invoice.vendorName)
    const target = mapping.get(`${l.invoice.accountId}::${vk}::${l.sku}`)
    if (!target || target === l.canonicalIngredientId) continue

    const bucket = l.canonicalIngredientId == null ? link : repoint
    const k = `${vk}::${l.sku}::${l.canonicalIngredientId ?? "null"}`
    const m = bucket.get(k) ?? {
      ids: [],
      spend: 0,
      from: l.canonicalIngredientId ?? "UNMATCHED",
      to: target,
      sku: l.sku,
      vendorKey: vk,
    }
    m.ids.push(l.id)
    m.spend += l.extendedPrice ?? 0
    bucket.set(k, m)
    touchedCanonicals.add(target)
    if (l.canonicalIngredientId) touchedCanonicals.add(l.canonicalIngredientId)
  }

  const canonNames = new Map(
    (
      await prisma.canonicalIngredient.findMany({
        where: { id: { in: [...touchedCanonicals] } },
        select: { id: true, name: true },
      })
    ).map((c) => [c.id, c.name])
  )
  const label = (id: string) => (id === "UNMATCHED" ? "UNMATCHED" : canonNames.get(id) ?? id)

  const report = async (title: string, moves: Map<string, Move>) => {
    const all = [...moves.values()]
    const totalLines = all.reduce((s, m) => s + m.ids.length, 0)
    const totalSpend = all.reduce((s, m) => s + m.spend, 0)
    console.log(`\n${title}: ${totalLines} line(s), ${money(totalSpend)}`)
    for (const m of all.sort((a, b) => b.spend - a.spend)) {
      console.log(
        `   ${m.vendorKey} / sku ${m.sku}: ${m.ids.length} line(s) ${money(m.spend)}` +
          `\n      ${label(m.from)}  →  ${label(m.to)}`
      )
      if (APPLY) {
        await prisma.invoiceLineItem.updateMany({
          where: { id: { in: m.ids } },
          data: { canonicalIngredientId: m.to, matchSource: "sku", matchedAt: new Date() },
        })
      }
    }
  }
  await report("4. re-point mis-linked lines", repoint)
  await report("5. link unmatched lines", link)

  // ---------- 6. recompute costs ----------
  console.log(`\n6. cost recompute: ${touchedCanonicals.size} canonical(s)`)
  for (const id of touchedCanonicals) {
    if (!APPLY) {
      console.log(`   ${label(id)}: would recompute`)
      continue
    }
    const before = await prisma.canonicalIngredient.findUnique({
      where: { id },
      select: { costPerRecipeUnit: true, recipeUnit: true },
    })
    const res = await recomputeCanonicalCost(id)
    const after = await prisma.canonicalIngredient.findUnique({
      where: { id },
      select: { costPerRecipeUnit: true, recipeUnit: true },
    })
    console.log(
      `   ${label(id)}: ${before?.costPerRecipeUnit ?? "-"} → ${after?.costPerRecipeUnit ?? "-"} ` +
        `per ${after?.recipeUnit ?? "-"} (${res.status}${"reason" in res && res.reason ? `: ${res.reason}` : ""})`
    )
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply.")
    console.log(
      "After applying, run prisma/manual-migrations/2026-08-18_ingredient_sku_match_vendor_key.sql\n" +
        "to create the vendorKey unique indexes. NOT `prisma db push` — the live schema drifts on\n" +
        "tables that are retained on purpose, and a push would drop them."
    )
  }
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
