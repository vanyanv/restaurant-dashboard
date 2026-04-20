// scripts/dedupe-canonicals-by-sku.ts
//
// Dedupe CanonicalIngredient rows keyed by (normalizedVendor, sku). The seed
// at src/lib/canonical-ingredients.ts keyed by normalized product-name, but
// invoice extractors spell the same SKU many ways. This script walks every
// (vendor, sku) group, picks a winner canonical, merges losers into it,
// upserts an IngredientSkuMatch, and backfills all InvoiceLineItems.
//
// Usage:
//   npx tsx scripts/dedupe-canonicals-by-sku.ts                 # dry-run (default)
//   npx tsx scripts/dedupe-canonicals-by-sku.ts --commit         # apply changes
//   npx tsx scripts/dedupe-canonicals-by-sku.ts --pick=Sysco:3589484:<canonicalId>  # force winner for a group (repeatable)

import fs from "fs"
import path from "path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvLocal()

type CliArgs = {
  commit: boolean
  picks: Map<string, string>   // key = `${vendor}::${sku}`, value = canonicalId
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const picks = new Map<string, string>()
  let commit = false
  for (const arg of args) {
    if (arg === "--commit") commit = true
    else if (arg === "--dry-run") commit = false
    else if (arg.startsWith("--pick=")) {
      const body = arg.slice("--pick=".length)
      const parts = body.split(":")
      if (parts.length < 3) {
        console.error(`Bad --pick value: ${arg} (expected vendor:sku:canonicalId)`)
        process.exit(1)
      }
      // canonicalId may contain colons? cuid doesn't, but be safe with the last segment.
      const canonicalId = parts[parts.length - 1]
      const sku = parts[parts.length - 2]
      const vendor = parts.slice(0, parts.length - 2).join(":")
      picks.set(`${vendor}::${sku}`, canonicalId)
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: npx tsx scripts/dedupe-canonicals-by-sku.ts [--commit] [--pick=vendor:sku:canonicalId]...")
      process.exit(0)
    } else {
      console.error(`Unknown arg: ${arg}`)
      process.exit(1)
    }
  }
  return { commit, picks }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n - 1) + "…"
  return s.padEnd(n)
}

function pickWinner(
  candidates: Array<{
    id: string
    name: string
    aliasCount: number
    lineItemCount: number
    createdAt: Date
  }>
): string {
  // Tie-break order: most line items FK'd > most aliases > cleanest-looking name > oldest.
  const scored = candidates.map((c) => {
    const hasLower = /[a-z]/.test(c.name)
    const hasUpper = /[A-Z]/.test(c.name)
    const mixedCase = hasLower && hasUpper ? 1 : 0
    const allCaps = !hasLower ? 1 : 0
    return {
      ...c,
      mixedCase,
      allCaps,
    }
  })
  scored.sort((a, b) => {
    if (a.lineItemCount !== b.lineItemCount) return b.lineItemCount - a.lineItemCount
    if (a.aliasCount !== b.aliasCount) return b.aliasCount - a.aliasCount
    if (a.mixedCase !== b.mixedCase) return b.mixedCase - a.mixedCase
    if (a.allCaps !== b.allCaps) return a.allCaps - b.allCaps
    if (a.name.length !== b.name.length) return b.name.length - a.name.length
    return a.createdAt.getTime() - b.createdAt.getTime()
  })
  return scored[0].id
}

async function main() {
  const cli = parseArgs()
  const mode = cli.commit ? "COMMIT" : "DRY-RUN"
  console.log(`\n${mode}: dedupe canonicals by (normalizedVendor, sku)\n`)

  const { prisma } = await import("../src/lib/prisma")
  const { normalizeVendorName } = await import("../src/lib/vendor-normalize")

  // 1. Load every line item with a SKU, the invoice vendor/store, and any
  //    existing FK-linked canonical.
  const lineItems = await prisma.invoiceLineItem.findMany({
    where: { sku: { not: null } },
    select: {
      id: true,
      sku: true,
      productName: true,
      unit: true,
      invoiceId: true,
      canonicalIngredientId: true,
      invoice: {
        select: {
          ownerId: true,
          vendorName: true,
          storeId: true,
        },
      },
    },
  })
  console.log(`Loaded ${lineItems.length} line items with SKU.\n`)

  // 2. Group by (ownerId, normalizedVendor, sku).
  type LineInfo = typeof lineItems[number]
  type Group = {
    ownerId: string
    vendor: string
    sku: string
    lineItems: LineInfo[]
    productNames: Set<string>
    storeIds: Set<string>
  }
  const groups = new Map<string, Group>()
  for (const li of lineItems) {
    if (!li.sku) continue
    const vendor = normalizeVendorName(li.invoice.vendorName)
    const key = `${li.invoice.ownerId}::${vendor}::${li.sku}`
    let g = groups.get(key)
    if (!g) {
      g = {
        ownerId: li.invoice.ownerId,
        vendor,
        sku: li.sku,
        lineItems: [],
        productNames: new Set(),
        storeIds: new Set(),
      }
      groups.set(key, g)
    }
    g.lineItems.push(li)
    g.productNames.add(li.productName)
    if (li.invoice.storeId) g.storeIds.add(li.invoice.storeId)
  }
  console.log(`Grouped into ${groups.size} distinct (owner, vendor, sku) pairs.\n`)

  // 3. For each group, discover every canonical already referenced.
  //    Sources:
  //      a. Direct FK on any line item in the group
  //      b. IngredientAlias match on (storeId, productName) for any line
  //      c. CanonicalIngredient by normalized-name match (legacy seed path)
  //    (c) is a best-effort — we only merge (a) and (b) candidates; (c) is
  //    reported as a hint in case the user wants to --pick it.

  // Pre-load all aliases for the stores we touch.
  const allStoreIds = new Set<string>()
  for (const g of groups.values()) g.storeIds.forEach((s) => allStoreIds.add(s))
  const aliases = allStoreIds.size
    ? await prisma.ingredientAlias.findMany({
        where: { storeId: { in: [...allStoreIds] } },
        select: {
          storeId: true,
          rawName: true,
          canonicalIngredientId: true,
        },
      })
    : []
  const aliasByStoreName = new Map<string, string | null>()
  for (const a of aliases) {
    aliasByStoreName.set(`${a.storeId}::${a.rawName.toLowerCase()}`, a.canonicalIngredientId)
  }

  // Pre-load CanonicalIngredient stats (aliasCount, lineItemCount, createdAt, ownerId, name).
  const allCanonicals = await prisma.canonicalIngredient.findMany({
    select: {
      id: true,
      ownerId: true,
      name: true,
      defaultUnit: true,
      createdAt: true,
      _count: { select: { aliases: true, invoiceLineItems: true } },
    },
  })
  const canonicalById = new Map(allCanonicals.map((c) => [c.id, c]))
  const canonicalByOwnerLowerName = new Map<string, string>()
  for (const c of allCanonicals) {
    canonicalByOwnerLowerName.set(`${c.ownerId}::${c.name.toLowerCase()}`, c.id)
  }

  // Rough lowercase + collapse-whitespace normalizer (mirrors seed logic).
  function normalizeProductName(raw: string): string {
    return raw
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\s*\([^)]*\)\s*$/g, "")
      .trim()
  }

  type Plan = {
    key: string
    ownerId: string
    vendor: string
    sku: string
    lineCount: number
    candidateCanonicals: string[]
    winnerId: string | null
    winnerSource: "fk" | "alias" | "name-match" | "only-option" | "manual-pick" | "needs-create"
    losers: string[]
  }
  const plans: Plan[] = []
  const orphanGroups: Group[] = []    // no canonical yet — will create one on commit

  for (const [key, g] of groups) {
    const candSet = new Set<string>()
    // (a) direct FK
    for (const li of g.lineItems) if (li.canonicalIngredientId) candSet.add(li.canonicalIngredientId)
    // (b) alias on (storeId, productName)
    for (const li of g.lineItems) {
      if (!li.invoice.storeId) continue
      const aliasCan = aliasByStoreName.get(`${li.invoice.storeId}::${li.productName.toLowerCase()}`)
      if (aliasCan) candSet.add(aliasCan)
    }
    // (c) name match
    for (const name of g.productNames) {
      const canId = canonicalByOwnerLowerName.get(`${g.ownerId}::${normalizeProductName(name)}`)
      if (canId) candSet.add(canId)
    }

    const pickKey = `${g.vendor}::${g.sku}`
    const manual = cli.picks.get(pickKey)
    if (manual) {
      if (!canonicalById.has(manual)) {
        console.error(`  FATAL: --pick ${pickKey} referenced canonical ${manual} which does not exist`)
        process.exit(1)
      }
      candSet.add(manual)
    }

    const candidates = [...candSet]
    if (candidates.length === 0) {
      orphanGroups.push(g)
      plans.push({
        key,
        ownerId: g.ownerId,
        vendor: g.vendor,
        sku: g.sku,
        lineCount: g.lineItems.length,
        candidateCanonicals: [],
        winnerId: null,
        winnerSource: "needs-create",
        losers: [],
      })
      continue
    }

    let winnerId: string
    let winnerSource: Plan["winnerSource"]
    if (manual) {
      winnerId = manual
      winnerSource = "manual-pick"
    } else if (candidates.length === 1) {
      winnerId = candidates[0]
      winnerSource = "only-option"
    } else {
      const enriched = candidates
        .map((id) => canonicalById.get(id))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => ({
          id: c.id,
          name: c.name,
          aliasCount: c._count.aliases,
          lineItemCount: c._count.invoiceLineItems,
          createdAt: c.createdAt,
        }))
      winnerId = pickWinner(enriched)
      winnerSource = "fk"
    }

    const losers = candidates.filter((id) => id !== winnerId)

    plans.push({
      key,
      ownerId: g.ownerId,
      vendor: g.vendor,
      sku: g.sku,
      lineCount: g.lineItems.length,
      candidateCanonicals: candidates,
      winnerId,
      winnerSource,
      losers,
    })
  }

  // 4. Report.
  console.log("=== MERGE PLAN ===\n")
  console.log(
    "vendor".padEnd(22) +
    "sku".padEnd(14) +
    "lines".padEnd(8) +
    "cands".padEnd(7) +
    "winner (source)".padEnd(46) +
    "losers"
  )
  console.log("-".repeat(120))
  let mergesNeeded = 0
  let skuMatchesToCreate = 0
  let orphansToCreate = 0
  for (const p of plans) {
    const winnerName = p.winnerId ? canonicalById.get(p.winnerId)?.name.slice(0, 30) ?? "?" : "(create new)"
    const winnerCol = `${winnerName} (${p.winnerSource})`
    const losersStr = p.losers.length
      ? p.losers.map((id) => canonicalById.get(id)?.name.slice(0, 20) ?? id).join(", ")
      : "—"
    console.log(
      pad(p.vendor, 22) +
      pad(p.sku, 14) +
      pad(String(p.lineCount), 8) +
      pad(String(p.candidateCanonicals.length), 7) +
      pad(winnerCol, 46) +
      losersStr.slice(0, 60)
    )
    if (p.losers.length > 0) mergesNeeded += p.losers.length
    if (p.winnerSource === "needs-create") orphansToCreate++
    skuMatchesToCreate++
  }

  console.log("\n=== SUMMARY ===")
  console.log(`  SKU groups:               ${plans.length}`)
  console.log(`  Canonicals to merge away: ${mergesNeeded}`)
  console.log(`  Orphan groups (no canonical yet — will create): ${orphansToCreate}`)
  console.log(`  IngredientSkuMatch rows to upsert: ${skuMatchesToCreate}`)

  // Dupe line-item warning (same invoice + sku twice).
  const dupLines = await prisma.$queryRaw<
    Array<{ invoiceNumber: string | null; vendorName: string; sku: string | null; dupCount: bigint }>
  >`
    SELECT i."invoiceNumber", i."vendorName", li.sku, count(*) as "dupCount"
    FROM "InvoiceLineItem" li
    JOIN "Invoice" i ON i.id = li."invoiceId"
    WHERE li.sku IS NOT NULL
    GROUP BY li."invoiceId", li.sku, i."invoiceNumber", i."vendorName"
    HAVING count(*) > 1
  `
  if (dupLines.length > 0) {
    console.log(`\n=== WARNING: true dupe line items on a single invoice (manual review) ===`)
    for (const d of dupLines) {
      console.log(`  ${d.vendorName} / invoice=${d.invoiceNumber} / sku=${d.sku}  × ${d.dupCount}`)
    }
  }

  if (!cli.commit) {
    console.log("\n(dry-run — no changes written. Re-run with --commit to apply.)\n")
    await prisma.$disconnect()
    return
  }

  // 5. Commit: one transaction per group.
  console.log("\n=== APPLYING CHANGES ===\n")
  let mergedCanonicals = 0
  let backfilledLineItems = 0
  let createdCanonicals = 0
  let createdSkuMatches = 0

  // Track canonicals deleted by an earlier plan and where they were merged to.
  // A canonical that is a "winner" in plan B may have been a "loser" in plan A,
  // in which case we must redirect winnerId to A's winner.
  const mergedInto = new Map<string, string>()
  function resolveId(id: string): string {
    let cur = id
    const seen = new Set<string>()
    while (mergedInto.has(cur)) {
      if (seen.has(cur)) throw new Error(`cycle in mergedInto at ${cur}`)
      seen.add(cur)
      cur = mergedInto.get(cur)!
    }
    return cur
  }

  for (const p of plans) {
    const g = groups.get(p.key)!

    await prisma.$transaction(async (tx) => {
      // 5a. Handle orphan groups — create a canonical from the cleanest productName.
      let winnerId = p.winnerId ? resolveId(p.winnerId) : null
      if (!winnerId) {
        const cleanestName = [...g.productNames].sort((a, b) => {
          const aMixed = /[a-z]/.test(a) && /[A-Z]/.test(a) ? 1 : 0
          const bMixed = /[a-z]/.test(b) && /[A-Z]/.test(b) ? 1 : 0
          if (aMixed !== bMixed) return bMixed - aMixed
          return b.length - a.length
        })[0]
        const created = await tx.canonicalIngredient.create({
          data: {
            ownerId: g.ownerId,
            name: normalizeProductName(cleanestName),
            defaultUnit: g.lineItems[0].unit ?? "unit",
          },
        })
        winnerId = created.id
        createdCanonicals++
      }

      // 5b. Merge losers into winner (inline version of mergeCanonicalIngredients).
      //     Re-resolve each loser through mergedInto — if it was already merged
      //     away by an earlier plan, we can skip it or point it at its new home.
      const resolvedLosers = [...new Set(p.losers.map(resolveId))].filter((id) => id !== winnerId)
      for (const loserId of resolvedLosers) {
        if (loserId === winnerId) continue
        // If loserId doesn't exist anymore (shouldn't happen after resolve, but guard), skip.
        const exists = await tx.canonicalIngredient.findUnique({ where: { id: loserId }, select: { id: true } })
        if (!exists) continue
        await tx.recipeIngredient.updateMany({
          where: { canonicalIngredientId: loserId },
          data: { canonicalIngredientId: winnerId },
        })
        await tx.invoiceLineItem.updateMany({
          where: { canonicalIngredientId: loserId },
          data: { canonicalIngredientId: winnerId },
        })

        // SKU matches collision resolution
        const targetSkuKeys = new Set(
          (await tx.ingredientSkuMatch.findMany({
            where: { canonicalIngredientId: winnerId },
            select: { vendorName: true, sku: true },
          })).map((m) => `${m.vendorName}::${m.sku}`)
        )
        const sourceSku = await tx.ingredientSkuMatch.findMany({
          where: { canonicalIngredientId: loserId },
          select: { id: true, vendorName: true, sku: true },
        })
        const collidingSku = sourceSku
          .filter((m) => targetSkuKeys.has(`${m.vendorName}::${m.sku}`))
          .map((m) => m.id)
        if (collidingSku.length > 0) {
          await tx.ingredientSkuMatch.deleteMany({ where: { id: { in: collidingSku } } })
        }
        await tx.ingredientSkuMatch.updateMany({
          where: { canonicalIngredientId: loserId },
          data: { canonicalIngredientId: winnerId },
        })

        // Alias collision resolution
        const targetAliasKeys = new Set(
          (await tx.ingredientAlias.findMany({
            where: { canonicalIngredientId: winnerId },
            select: { storeId: true, rawName: true },
          })).map((a) => `${a.storeId}::${a.rawName}`)
        )
        const sourceAliases = await tx.ingredientAlias.findMany({
          where: { canonicalIngredientId: loserId },
          select: { id: true, storeId: true, rawName: true },
        })
        const collidingAliases = sourceAliases
          .filter((a) => targetAliasKeys.has(`${a.storeId}::${a.rawName}`))
          .map((a) => a.id)
        if (collidingAliases.length > 0) {
          await tx.ingredientAlias.deleteMany({ where: { id: { in: collidingAliases } } })
        }
        await tx.ingredientAlias.updateMany({
          where: { canonicalIngredientId: loserId },
          data: { canonicalIngredientId: winnerId },
        })

        await tx.canonicalIngredient.delete({ where: { id: loserId } })
        mergedInto.set(loserId, winnerId!)
        mergedCanonicals++
      }

      // 5c. Upsert IngredientSkuMatch for (owner, vendor, sku) → winner.
      const firstLine = g.lineItems[0]
      await tx.ingredientSkuMatch.upsert({
        where: {
          ownerId_vendorName_sku: {
            ownerId: g.ownerId,
            vendorName: g.vendor,
            sku: g.sku,
          },
        },
        update: {
          canonicalIngredientId: winnerId,
          confirmedAt: new Date(),
        },
        create: {
          ownerId: g.ownerId,
          vendorName: g.vendor,
          sku: g.sku,
          canonicalIngredientId: winnerId,
          conversionFactor: 1,
          fromUnit: firstLine.unit ?? "unit",
          toUnit: firstLine.unit ?? "unit",
          confirmedBy: g.ownerId,
        },
      })
      createdSkuMatches++

      // 5d. Backfill every line item in this group that isn't already pointed at the winner.
      const lineIds = g.lineItems.map((li) => li.id)
      const backfill = await tx.invoiceLineItem.updateMany({
        where: {
          id: { in: lineIds },
          OR: [
            { canonicalIngredientId: null },
            { canonicalIngredientId: { not: winnerId } },
          ],
        },
        data: {
          canonicalIngredientId: winnerId,
          matchSource: "sku",
          matchedAt: new Date(),
        },
      })
      backfilledLineItems += backfill.count
    }, { timeout: 60_000, maxWait: 10_000 })
  }

  console.log(`\n=== DONE ===`)
  console.log(`  Canonicals created (orphan groups): ${createdCanonicals}`)
  console.log(`  Canonicals merged away:             ${mergedCanonicals}`)
  console.log(`  IngredientSkuMatch upserted:        ${createdSkuMatches}`)
  console.log(`  InvoiceLineItems backfilled:        ${backfilledLineItems}`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
