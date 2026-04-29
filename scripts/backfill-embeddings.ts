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

interface Args {
  limit: number | null
  invoicesOnly: boolean
  menuOnly: boolean
  recipesOnly: boolean
  ingredientsOnly: boolean
}

function parseArgs(): Args {
  const args: Args = {
    limit: null,
    invoicesOnly: false,
    menuOnly: false,
    recipesOnly: false,
    ingredientsOnly: false,
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
             (id, "invoiceId", "invoiceLineId", "ownerId", "contentSnapshot", embedding, "createdAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5::vector, NOW())`,
          [row.invoiceId, row.lineId, row.ownerId, row.hash, toVectorLiteral(vec)],
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
    select: { id: true, name: true, ownerId: true },
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
             (id, "menuItemId", "ownerId", "storeId", "category", "itemName",
              "contentSnapshot", embedding, "createdAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7::vector, NOW())`,
          [
            row.menuItemId,
            row.ownerId,
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
             (id, "recipeId", "ownerId", "category", "itemName",
              "contentSnapshot", embedding, "createdAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::vector, NOW())`,
          [
            row.recipeId,
            row.ownerId,
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
             (id, "canonicalIngredientId", "ownerId", "category", "name",
              "contentSnapshot", embedding, "createdAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::vector, NOW())`,
          [
            row.canonicalIngredientId,
            row.ownerId,
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

async function main() {
  const args = parseArgs()
  // Determine which corpora to run. With no flags, run all four. Any
  // *Only flag restricts to that corpus exclusively.
  const onlyFlags = [
    args.invoicesOnly,
    args.menuOnly,
    args.recipesOnly,
    args.ingredientsOnly,
  ]
  const anyOnly = onlyFlags.some(Boolean)
  const runInvoices = !anyOnly || args.invoicesOnly
  const runMenu = !anyOnly || args.menuOnly
  const runRecipes = !anyOnly || args.recipesOnly
  const runIngredients = !anyOnly || args.ingredientsOnly

  const c = rawClient()
  await c.connect()
  try {
    if (runInvoices) await backfillInvoices(c, args.limit)
    if (runMenu) await backfillMenu(c, args.limit)
    if (runRecipes) await backfillRecipes(c, args.limit)
    if (runIngredients) await backfillCanonicalIngredients(c, args.limit)
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
