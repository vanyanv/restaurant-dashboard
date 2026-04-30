/**
 * One-time + idempotent backfill of vector embeddings for the chat layer.
 *
 *   - InvoiceLineEmbedding: one row per InvoiceLineItem (vendor name + product
 *     line text). Skipped if the line already has an embedding with the same
 *     contentSnapshot hash.
 *   - MenuItemEmbedding: one row per distinct (storeId, category, itemName)
 *     in OtterMenuItem (modifiers excluded). Synthetic menuItemId is stable
 *     across runs so re-runs upsert instead of duplicating.
 *   - RecipeEmbedding: one row per owner Recipe. Chunk text folds in a few
 *     ingredient names so semantic queries hit on contents, not just title.
 *   - CanonicalIngredientEmbedding: one row per owner CanonicalIngredient.
 *     Chunk text folds in the per-store IngredientAlias rawNames so vendor
 *     jargon matches the canonical.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/backfill-embeddings.ts
 *   npx tsx --env-file=.env.local scripts/backfill-embeddings.ts --limit 50
 *   npx tsx --env-file=.env.local scripts/backfill-embeddings.ts --invoices-only
 *   npx tsx --env-file=.env.local scripts/backfill-embeddings.ts --menu-only
 *   npx tsx --env-file=.env.local scripts/backfill-embeddings.ts --recipes-only
 *   npx tsx --env-file=.env.local scripts/backfill-embeddings.ts --ingredients-only
 */

import { createHash } from "node:crypto"
import { Client } from "pg"

// Point Prisma at the chat-layer Neon branch (DATABASE_URL2) before the
// prisma client module is loaded. The main DATABASE_URL is the shared app
// DB; the vector tables + embeddings live on URL2.
if (process.env.DATABASE_URL2) {
  process.env.DATABASE_URL = process.env.DATABASE_URL2
}

import { prisma } from "../src/lib/prisma"
import {
  embedBatch,
  snapshotHash,
  toVectorLiteral,
} from "../src/lib/chat/embeddings"
import {
  bucketSummariesByPeriod,
  computeStorePnL,
  type Period,
} from "../src/lib/pnl"
import { CogsStatus } from "../src/generated/prisma/client"

interface Args {
  limit: number | null
  invoicesOnly: boolean
  menuOnly: boolean
  recipesOnly: boolean
  ingredientsOnly: boolean
  pnlOnly: boolean
}

function parseArgs(): Args {
  const args: Args = {
    limit: null,
    invoicesOnly: false,
    menuOnly: false,
    recipesOnly: false,
    ingredientsOnly: false,
    pnlOnly: false,
  }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--limit") {
      args.limit = Number(argv[++i])
      if (!Number.isFinite(args.limit) || args.limit! <= 0) {
        throw new Error("--limit must be a positive integer")
      }
    } else if (a === "--invoices-only") {
      args.invoicesOnly = true
    } else if (a === "--menu-only") {
      args.menuOnly = true
    } else if (a === "--recipes-only") {
      args.recipesOnly = true
    } else if (a === "--ingredients-only") {
      args.ingredientsOnly = true
    } else if (a === "--pnl-only") {
      args.pnlOnly = true
    } else {
      throw new Error(`unknown arg: ${a}`)
    }
  }
  return args
}

function rawClient(): Client {
  const url = process.env.DATABASE_URL2 ?? process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL2 (or DATABASE_URL) not set")
  return new Client({ connectionString: url })
}

function deriveMenuItemId(
  storeId: string,
  category: string,
  itemName: string,
): string {
  const key = `${storeId}|${category}|${itemName}`
  return createHash("sha256").update(key).digest("hex").slice(0, 24)
}

function buildInvoiceLineText(
  vendor: string,
  productName: string,
  description: string | null,
  unit: string | null,
  category: string | null,
): string {
  const parts = [vendor.trim(), productName.trim()]
  if (description && description.trim()) parts.push(description.trim())
  if (unit && unit.trim()) parts.push(`(${unit.trim()})`)
  if (category && category.trim()) parts.push(`[${category.trim()}]`)
  return parts.join(" · ")
}

function buildMenuItemText(
  itemName: string,
  category: string,
  storeName: string,
): string {
  return `${itemName} (${category}) at ${storeName}`
}

function buildRecipeText(
  itemName: string,
  category: string,
  ingredientNames: string[],
): string {
  const top = ingredientNames.filter((n) => n && n.trim()).slice(0, 5)
  const tail = top.length > 0 ? ` — ingredients: ${top.join(", ")}` : ""
  return `${itemName} (${category})${tail}`
}

function buildCanonicalIngredientText(
  name: string,
  category: string | null,
  aliases: string[],
): string {
  const cleanedAliases = Array.from(
    new Set(
      aliases
        .map((a) => a?.trim())
        .filter((a): a is string => !!a && a.toLowerCase() !== name.toLowerCase()),
    ),
  ).slice(0, 12)
  const cat = category ? ` [${category.trim()}]` : ""
  const ali = cleanedAliases.length > 0
    ? ` · aliases: ${cleanedAliases.join(", ")}`
    : ""
  return `${name}${cat}${ali}`
}

async function backfillInvoices(c: Client, limit: number | null) {
  const lines = await prisma.invoiceLineItem.findMany({
    where: { extendedPrice: { gt: 0 } },
    select: {
      id: true,
      productName: true,
      description: true,
      unit: true,
      category: true,
      invoice: {
        select: {
          id: true,
          ownerId: true,
          accountId: true,
          vendorName: true,
        },
      },
    },
    orderBy: { id: "asc" },
    take: limit ?? undefined,
  })
  console.log(`[invoices] ${lines.length} line items`)

  const existing = await c.query<{
    invoiceLineId: string
    contentSnapshot: string
  }>(
    `SELECT "invoiceLineId", "contentSnapshot"
       FROM "InvoiceLineEmbedding"
      WHERE "invoiceLineId" = ANY($1::text[])`,
    [lines.map((l) => l.id)],
  )
  const existingByLineId = new Map<string, string>()
  for (const row of existing.rows) {
    if (row.invoiceLineId) existingByLineId.set(row.invoiceLineId, row.contentSnapshot)
  }

  const toEmbed: Array<{
    lineId: string
    invoiceId: string
    ownerId: string
    accountId: string
    text: string
    hash: string
  }> = []
  let skipped = 0
  for (const l of lines) {
    const text = buildInvoiceLineText(
      l.invoice.vendorName,
      l.productName,
      l.description,
      l.unit,
      l.category,
    )
    const hash = snapshotHash(text)
    if (existingByLineId.get(l.id) === hash) {
      skipped++
      continue
    }
    toEmbed.push({
      lineId: l.id,
      invoiceId: l.invoice.id,
      ownerId: l.invoice.ownerId,
      accountId: l.invoice.accountId,
      text,
      hash,
    })
  }
  console.log(`[invoices] ${skipped} skipped (unchanged), ${toEmbed.length} to embed`)

  for (let i = 0; i < toEmbed.length; i += 100) {
    const chunk = toEmbed.slice(i, i + 100)
    const vectors = await embedBatch(chunk.map((c) => c.text))

    await c.query("BEGIN")
    try {
      for (let j = 0; j < chunk.length; j++) {
        const row = chunk[j]
        const vec = vectors[j]
        await c.query(
          `DELETE FROM "InvoiceLineEmbedding" WHERE "invoiceLineId" = $1`,
          [row.lineId],
        )
        await c.query(
          `INSERT INTO "InvoiceLineEmbedding"
             (id, "invoiceId", "invoiceLineId", "ownerId", "accountId", "contentSnapshot", embedding, "createdAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::vector, NOW())`,
          [row.invoiceId, row.lineId, row.ownerId, row.accountId, row.hash, toVectorLiteral(vec)],
        )
      }
      await c.query("COMMIT")
      console.log(`[invoices] wrote ${i + chunk.length}/${toEmbed.length}`)
    } catch (err) {
      await c.query("ROLLBACK")
      throw err
    }
  }
}

async function backfillMenu(c: Client, limit: number | null) {
  const grouped = await prisma.otterMenuItem.groupBy({
    by: ["storeId", "category", "itemName"],
    where: { isModifier: false },
    _sum: { fpQuantitySold: true, tpQuantitySold: true },
    orderBy: [{ storeId: "asc" }, { category: "asc" }, { itemName: "asc" }],
    take: limit ?? undefined,
  })
  console.log(`[menu] ${grouped.length} distinct menu items`)

  if (grouped.length === 0) return

  const storeIds = Array.from(new Set(grouped.map((g) => g.storeId)))
  const stores = await prisma.store.findMany({
    where: { id: { in: storeIds } },
    select: { id: true, name: true, ownerId: true, accountId: true },
  })
  const storeById = new Map(stores.map((s) => [s.id, s]))

  const synthesized = grouped.map((g) => {
    const store = storeById.get(g.storeId)
    if (!store) throw new Error(`unknown store ${g.storeId}`)
    const menuItemId = deriveMenuItemId(g.storeId, g.category, g.itemName)
    const text = buildMenuItemText(g.itemName, g.category, store.name)
    return {
      menuItemId,
      ownerId: store.ownerId,
      accountId: store.accountId,
      storeId: g.storeId,
      category: g.category,
      itemName: g.itemName,
      text,
      hash: snapshotHash(text),
    }
  })

  const existing = await c.query<{
    menuItemId: string
    contentSnapshot: string
  }>(
    `SELECT "menuItemId", "contentSnapshot" FROM "MenuItemEmbedding"
      WHERE "menuItemId" = ANY($1::text[])`,
    [synthesized.map((s) => s.menuItemId)],
  )
  const existingHash = new Map(
    existing.rows.map((r) => [r.menuItemId, r.contentSnapshot]),
  )

  const toEmbed = synthesized.filter(
    (s) => existingHash.get(s.menuItemId) !== s.hash,
  )
  const skipped = synthesized.length - toEmbed.length
  console.log(`[menu] ${skipped} skipped (unchanged), ${toEmbed.length} to embed`)

  for (let i = 0; i < toEmbed.length; i += 100) {
    const chunk = toEmbed.slice(i, i + 100)
    const vectors = await embedBatch(chunk.map((c) => c.text))

    await c.query("BEGIN")
    try {
      for (let j = 0; j < chunk.length; j++) {
        const row = chunk[j]
        const vec = vectors[j]
        await c.query(
          `DELETE FROM "MenuItemEmbedding" WHERE "menuItemId" = $1`,
          [row.menuItemId],
        )
        await c.query(
          `INSERT INTO "MenuItemEmbedding"
             (id, "menuItemId", "ownerId", "accountId", "storeId", "category", "itemName",
              "contentSnapshot", embedding, "createdAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8::vector, NOW())`,
          [
            row.menuItemId,
            row.ownerId,
            row.accountId,
            row.storeId,
            row.category,
            row.itemName,
            row.hash,
            toVectorLiteral(vec),
          ],
        )
      }
      await c.query("COMMIT")
      console.log(`[menu] wrote ${i + chunk.length}/${toEmbed.length}`)
    } catch (err) {
      await c.query("ROLLBACK")
      throw err
    }
  }
}

async function backfillRecipes(c: Client, limit: number | null) {
  const recipes = await prisma.recipe.findMany({
    select: {
      id: true,
      ownerId: true,
      accountId: true,
      itemName: true,
      category: true,
      ingredients: {
        select: {
          ingredientName: true,
          canonicalIngredient: { select: { name: true } },
          componentRecipe: { select: { itemName: true } },
        },
        take: 8,
      },
    },
    orderBy: { id: "asc" },
    take: limit ?? undefined,
  })
  console.log(`[recipes] ${recipes.length} recipes`)
  if (recipes.length === 0) return

  const synthesized = recipes.map((r) => {
    const ingredientNames = r.ingredients.map(
      (ri) =>
        ri.canonicalIngredient?.name ??
        ri.componentRecipe?.itemName ??
        ri.ingredientName ??
        "",
    )
    const text = buildRecipeText(r.itemName, r.category, ingredientNames)
    return {
      recipeId: r.id,
      ownerId: r.ownerId,
      accountId: r.accountId,
      category: r.category,
      itemName: r.itemName,
      text,
      hash: snapshotHash(text),
    }
  })

  const existing = await c.query<{
    recipeId: string
    contentSnapshot: string
  }>(
    `SELECT "recipeId", "contentSnapshot" FROM "RecipeEmbedding"
      WHERE "recipeId" = ANY($1::text[])`,
    [synthesized.map((s) => s.recipeId)],
  )
  const existingHash = new Map(
    existing.rows.map((r) => [r.recipeId, r.contentSnapshot]),
  )

  const toEmbed = synthesized.filter(
    (s) => existingHash.get(s.recipeId) !== s.hash,
  )
  const skipped = synthesized.length - toEmbed.length
  console.log(`[recipes] ${skipped} skipped (unchanged), ${toEmbed.length} to embed`)

  for (let i = 0; i < toEmbed.length; i += 100) {
    const chunk = toEmbed.slice(i, i + 100)
    const vectors = await embedBatch(chunk.map((c) => c.text))

    await c.query("BEGIN")
    try {
      for (let j = 0; j < chunk.length; j++) {
        const row = chunk[j]
        const vec = vectors[j]
        await c.query(
          `DELETE FROM "RecipeEmbedding" WHERE "recipeId" = $1`,
          [row.recipeId],
        )
        await c.query(
          `INSERT INTO "RecipeEmbedding"
             (id, "recipeId", "ownerId", "accountId", "category", "itemName",
              "contentSnapshot", embedding, "createdAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7::vector, NOW())`,
          [
            row.recipeId,
            row.ownerId,
            row.accountId,
            row.category,
            row.itemName,
            row.hash,
            toVectorLiteral(vec),
          ],
        )
      }
      await c.query("COMMIT")
      console.log(`[recipes] wrote ${i + chunk.length}/${toEmbed.length}`)
    } catch (err) {
      await c.query("ROLLBACK")
      throw err
    }
  }
}

async function backfillCanonicalIngredients(c: Client, limit: number | null) {
  const canonicals = await prisma.canonicalIngredient.findMany({
    select: {
      id: true,
      ownerId: true,
      accountId: true,
      name: true,
      category: true,
      aliases: { select: { rawName: true } },
    },
    orderBy: { id: "asc" },
    take: limit ?? undefined,
  })
  console.log(`[ingredients] ${canonicals.length} canonical ingredients`)
  if (canonicals.length === 0) return

  const synthesized = canonicals.map((ci) => {
    const aliasNames = ci.aliases.map((a) => a.rawName)
    const text = buildCanonicalIngredientText(ci.name, ci.category, aliasNames)
    return {
      canonicalIngredientId: ci.id,
      ownerId: ci.ownerId,
      accountId: ci.accountId,
      category: ci.category,
      name: ci.name,
      text,
      hash: snapshotHash(text),
    }
  })

  const existing = await c.query<{
    canonicalIngredientId: string
    contentSnapshot: string
  }>(
    `SELECT "canonicalIngredientId", "contentSnapshot"
       FROM "CanonicalIngredientEmbedding"
      WHERE "canonicalIngredientId" = ANY($1::text[])`,
    [synthesized.map((s) => s.canonicalIngredientId)],
  )
  const existingHash = new Map(
    existing.rows.map((r) => [r.canonicalIngredientId, r.contentSnapshot]),
  )

  const toEmbed = synthesized.filter(
    (s) => existingHash.get(s.canonicalIngredientId) !== s.hash,
  )
  const skipped = synthesized.length - toEmbed.length
  console.log(`[ingredients] ${skipped} skipped (unchanged), ${toEmbed.length} to embed`)

  for (let i = 0; i < toEmbed.length; i += 100) {
    const chunk = toEmbed.slice(i, i + 100)
    const vectors = await embedBatch(chunk.map((c) => c.text))

    await c.query("BEGIN")
    try {
      for (let j = 0; j < chunk.length; j++) {
        const row = chunk[j]
        const vec = vectors[j]
        await c.query(
          `DELETE FROM "CanonicalIngredientEmbedding" WHERE "canonicalIngredientId" = $1`,
          [row.canonicalIngredientId],
        )
        await c.query(
          `INSERT INTO "CanonicalIngredientEmbedding"
             (id, "canonicalIngredientId", "ownerId", "accountId", "category", "name",
              "contentSnapshot", embedding, "createdAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7::vector, NOW())`,
          [
            row.canonicalIngredientId,
            row.ownerId,
            row.accountId,
            row.category,
            row.name,
            row.hash,
            toVectorLiteral(vec),
          ],
        )
      }
      await c.query("COMMIT")
      console.log(`[ingredients] wrote ${i + chunk.length}/${toEmbed.length}`)
    } catch (err) {
      await c.query("ROLLBACK")
      throw err
    }
  }
}

// ─── Weekly P&L narrative snapshots ──────────────────────────────────────

const MS_PER_DAY = 86_400_000

/** Sunday at UTC 00:00 of the week containing `d`. */
function weekStartUTC(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  out.setUTCDate(out.getUTCDate() - out.getUTCDay())
  return out
}

function ymdUTC(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function fmtMoney(v: number): string {
  return `$${Math.round(v).toLocaleString("en-US")}`
}

function fmtPct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`
}

interface PnlSnapshot {
  snapshotId: string
  accountId: string
  storeId: string | null
  weekStart: Date
  text: string
}

function deriveSnapshotId(
  accountId: string,
  storeId: string | null,
  weekStart: Date,
): string {
  const key = `${accountId}|${storeId ?? "all"}|${ymdUTC(weekStart)}`
  return createHash("sha256").update(key).digest("hex").slice(0, 32)
}

function buildPnlText(input: {
  scope: string
  weekStart: Date
  netSales: number
  cogsDollars: number
  cogsPct: number
  laborDollars: number
  laborPct: number
  grossProfit: number
  grossMarginPct: number
  bottomLine: number
  netMarginPct: number
  laborConfigured: boolean
}): string {
  const labor = input.laborConfigured
    ? `${fmtMoney(input.laborDollars)} (${fmtPct(input.laborPct)} budgeted)`
    : "not configured"
  return [
    `Week of ${ymdUTC(input.weekStart)}, ${input.scope}:`,
    `net sales ${fmtMoney(input.netSales)},`,
    `COGS ${fmtMoney(input.cogsDollars)} (${fmtPct(input.cogsPct)}),`,
    `labor ${labor},`,
    `gross profit ${fmtMoney(input.grossProfit)} (${fmtPct(input.grossMarginPct)}),`,
    `bottom line ${fmtMoney(input.bottomLine)} (${fmtPct(input.netMarginPct)} margin).`,
  ].join(" ")
}

async function backfillPnlNarratives(c: Client) {
  // Find every account that has at least one OtterDailySummary row, with the
  // earliest date so we know how far back to walk. The primary table lives on
  // DATABASE_URL2 in the chat-layer Neon branch — same prisma client.
  const accounts = await prisma.account.findMany({
    select: {
      id: true,
      stores: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          fixedMonthlyLabor: true,
          fixedMonthlyRent: true,
          fixedMonthlyTowels: true,
          fixedMonthlyCleaning: true,
          uberCommissionRate: true,
          doordashCommissionRate: true,
        },
      },
    },
  })

  const today = new Date()
  // Cutoff = Sunday of the *current* week, exclusive — only embed weeks that
  // are fully closed.
  const currentWeekStart = weekStartUTC(today)

  const snapshots: PnlSnapshot[] = []

  for (const account of accounts) {
    if (account.stores.length === 0) continue
    const storeIds = account.stores.map((s) => s.id)

    // Earliest summary date for this account's stores bounds the backfill.
    const earliest = await prisma.otterDailySummary.findFirst({
      where: { storeId: { in: storeIds } },
      select: { date: true },
      orderBy: { date: "asc" },
    })
    if (!earliest) continue

    const earliestWeek = weekStartUTC(earliest.date)
    const weekStarts: Date[] = []
    for (
      let w = earliestWeek;
      w.getTime() < currentWeekStart.getTime();
      w = new Date(w.getTime() + 7 * MS_PER_DAY)
    ) {
      weekStarts.push(new Date(w))
    }
    if (weekStarts.length === 0) continue

    for (const weekStart of weekStarts) {
      const weekEnd = new Date(weekStart.getTime() + 6 * MS_PER_DAY)
      const period: Period = {
        label: `Week of ${ymdUTC(weekStart)}`,
        startDate: weekStart,
        endDate: weekEnd,
        days: 7,
        isPartial: false,
      }
      const periods = [period]

      const [summaries, cogsRows] = await Promise.all([
        prisma.otterDailySummary.findMany({
          where: {
            storeId: { in: storeIds },
            date: { gte: weekStart, lte: weekEnd },
          },
          select: {
            storeId: true,
            date: true,
            platform: true,
            paymentMethod: true,
            fpGrossSales: true,
            tpGrossSales: true,
            fpTaxCollected: true,
            tpTaxCollected: true,
            fpDiscounts: true,
            tpDiscounts: true,
            fpServiceCharges: true,
            tpServiceCharges: true,
          },
        }),
        prisma.dailyCogsItem.findMany({
          where: {
            storeId: { in: storeIds },
            date: { gte: weekStart, lte: weekEnd },
            status: CogsStatus.COSTED,
          },
          select: { storeId: true, date: true, lineCost: true },
        }),
      ])

      // No data for this week → skip.
      if (summaries.length === 0 && cogsRows.length === 0) continue

      const summariesByStore = new Map<string, typeof summaries>()
      for (const s of summaries) {
        const arr = summariesByStore.get(s.storeId) ?? []
        arr.push(s)
        summariesByStore.set(s.storeId, arr)
      }
      const cogsByStore = new Map<string, typeof cogsRows>()
      for (const r of cogsRows) {
        const arr = cogsByStore.get(r.storeId) ?? []
        arr.push(r)
        cogsByStore.set(r.storeId, arr)
      }

      // Per-store snapshots + accumulators for the all-stores rollup.
      let allNetSales = 0
      let allCogs = 0
      let allLabor = 0
      let allLaborConfigured = false
      let allGrossProfit = 0
      let allBottomLine = 0
      const fmtSnap = (
        scope: string,
        netSales: number,
        cogsDollars: number,
        laborDollars: number,
        grossProfit: number,
        bottomLine: number,
        laborConfigured: boolean,
      ): string => {
        const cogsPct = netSales > 0 ? cogsDollars / netSales : 0
        const laborPct = netSales > 0 ? laborDollars / netSales : 0
        const grossMarginPct = netSales > 0 ? grossProfit / netSales : 0
        const netMarginPct = netSales > 0 ? bottomLine / netSales : 0
        return buildPnlText({
          scope,
          weekStart,
          netSales,
          cogsDollars,
          cogsPct,
          laborDollars,
          laborPct,
          grossProfit,
          grossMarginPct,
          bottomLine,
          netMarginPct,
          laborConfigured,
        })
      }

      for (const store of account.stores) {
        const storeSummaries = summariesByStore.get(store.id) ?? []
        const storeCogs = cogsByStore.get(store.id) ?? []
        const bucketed = bucketSummariesByPeriod(storeSummaries, periods)
        const cogsValues = [storeCogs.reduce((acc, r) => acc + r.lineCost, 0)]
        const computed = computeStorePnL({
          bucketed,
          periods,
          store,
          cogsValues,
        })
        const netSales = computed.totalSales[0] ?? 0
        const cogsDollars = computed.cogsValues[0] ?? 0
        const laborDollars = computed.laborValues[0] ?? 0
        const grossProfit = computed.grossProfit[0] ?? 0
        const bottomLine = computed.bottomLine[0] ?? 0
        const laborConfigured = store.fixedMonthlyLabor != null

        if (netSales === 0 && cogsDollars === 0) continue

        const text = fmtSnap(
          store.name,
          netSales,
          cogsDollars,
          laborDollars,
          grossProfit,
          bottomLine,
          laborConfigured,
        )
        snapshots.push({
          snapshotId: deriveSnapshotId(account.id, store.id, weekStart),
          accountId: account.id,
          storeId: store.id,
          weekStart,
          text,
        })

        allNetSales += netSales
        allCogs += cogsDollars
        allLabor += laborDollars
        allLaborConfigured = allLaborConfigured || laborConfigured
        allGrossProfit += grossProfit
        allBottomLine += bottomLine
      }

      if (allNetSales > 0 || allCogs > 0) {
        const text = fmtSnap(
          "All stores",
          allNetSales,
          allCogs,
          allLabor,
          allGrossProfit,
          allBottomLine,
          allLaborConfigured,
        )
        snapshots.push({
          snapshotId: deriveSnapshotId(account.id, null, weekStart),
          accountId: account.id,
          storeId: null,
          weekStart,
          text,
        })
      }
    }
  }

  console.log(`[pnl] ${snapshots.length} candidate snapshots`)
  if (snapshots.length === 0) return

  const existing = await c.query<{ snapshotId: string; contentSnapshot: string }>(
    `SELECT "snapshotId", "contentSnapshot"
       FROM "PnlNarrativeEmbedding"
      WHERE "snapshotId" = ANY($1::text[])`,
    [snapshots.map((s) => s.snapshotId)],
  )
  // Skip-detection compares the stored narrative text against the freshly
  // generated text — see the INSERT below for why we store text rather than
  // a hash here.
  const existingText = new Map(
    existing.rows.map((r) => [r.snapshotId, r.contentSnapshot]),
  )

  const toEmbed = snapshots.filter((s) => existingText.get(s.snapshotId) !== s.text)
  const skipped = snapshots.length - toEmbed.length
  console.log(`[pnl] ${skipped} skipped (unchanged), ${toEmbed.length} to embed`)

  for (let i = 0; i < toEmbed.length; i += 100) {
    const chunk = toEmbed.slice(i, i + 100)
    const vectors = await embedBatch(chunk.map((c) => c.text))

    await c.query("BEGIN")
    try {
      for (let j = 0; j < chunk.length; j++) {
        const row = chunk[j]
        const vec = vectors[j]
        await c.query(
          `DELETE FROM "PnlNarrativeEmbedding" WHERE "snapshotId" = $1`,
          [row.snapshotId],
        )
        // Unlike the other embedding tables (which store the SHA hash in
        // contentSnapshot for skip-detection), we store the actual narrative
        // text — searchPnlHistory returns it directly as the prose snippet.
        // Skip-detection in this corpus compares the text itself.
        await c.query(
          `INSERT INTO "PnlNarrativeEmbedding"
             (id, "snapshotId", "accountId", "storeId", "weekStart",
              "contentSnapshot", embedding, "createdAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::vector, NOW())`,
          [
            row.snapshotId,
            row.accountId,
            row.storeId,
            ymdUTC(row.weekStart),
            row.text,
            toVectorLiteral(vec),
          ],
        )
      }
      await c.query("COMMIT")
      console.log(`[pnl] wrote ${i + chunk.length}/${toEmbed.length}`)
    } catch (err) {
      await c.query("ROLLBACK")
      throw err
    }
  }
}

async function main() {
  const args = parseArgs()
  // Determine which corpora to run. With no flags, run all five. Any
  // *Only flag restricts to that corpus exclusively.
  const onlyFlags = [
    args.invoicesOnly,
    args.menuOnly,
    args.recipesOnly,
    args.ingredientsOnly,
    args.pnlOnly,
  ]
  const anyOnly = onlyFlags.some(Boolean)
  const runInvoices = !anyOnly || args.invoicesOnly
  const runMenu = !anyOnly || args.menuOnly
  const runRecipes = !anyOnly || args.recipesOnly
  const runIngredients = !anyOnly || args.ingredientsOnly
  const runPnl = !anyOnly || args.pnlOnly

  const c = rawClient()
  await c.connect()
  try {
    if (runInvoices) await backfillInvoices(c, args.limit)
    if (runMenu) await backfillMenu(c, args.limit)
    if (runRecipes) await backfillRecipes(c, args.limit)
    if (runIngredients) await backfillCanonicalIngredients(c, args.limit)
    if (runPnl) await backfillPnlNarratives(c)
  } finally {
    await c.end()
    await prisma.$disconnect()
  }
  console.log("backfill complete")
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
