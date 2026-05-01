/**
 * Read-only fixture research for chat prompts and evals.
 *
 * Usage:
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/research-chat-db.ts
 */

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import pg from "pg"

type QueryRow = Record<string, unknown>

async function main() {
  await loadEnvLocal()
  const url = process.env.DATABASE_URL2
  if (!url) throw new Error("DATABASE_URL2 is required")

  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const accountId = await pickAccountId(client)
    console.log(`Chat DB research candidates for account ${accountId}`)
    console.log("Source: DATABASE_URL2")

    await printSection(client, "Active stores", storesSql, [accountId])
    await printSection(client, "Recent menu categories", menuCategoriesSql, [accountId])
    await printSection(client, "Top recent menu items", topMenuItemsSql, [accountId])
    await printSection(client, "Recipe categories", recipeCategoriesSql, [accountId])
    await printSection(client, "Sellable recipes", recipesSql, [accountId])
    await printSection(client, "Canonical ingredients with current costs", ingredientsSql, [
      accountId,
    ])
    await printSection(client, "Ingredient aliases", aliasesSql, [accountId])
    await printSection(client, "Invoice vendors", vendorsSql, [accountId])
    await printSection(client, "High-value recent invoices", invoicesSql, [accountId])
    await printSection(client, "High-value invoice line items", invoiceLinesSql, [
      accountId,
    ])
    await printSection(client, "Recent COGS item candidates", cogsSql, [accountId])
  } finally {
    await client.end()
  }
}

const storesSql = `
  SELECT "name", "address", "id"
    FROM "Store"
   WHERE "accountId" = $1
     AND "isActive" = true
   ORDER BY "name"`

const menuCategoriesSql = `
  SELECT m."category",
         COUNT(DISTINCT m."itemName")::int AS "itemCount",
         SUM(m."fpQuantitySold" + m."tpQuantitySold")::float8 AS "qtySold"
    FROM "OtterMenuItem" m
    JOIN "Store" s ON s.id = m."storeId"
   WHERE s."accountId" = $1
     AND m."isModifier" = false
     AND m."date" >= CURRENT_DATE - INTERVAL '90 days'
   GROUP BY m."category"
   ORDER BY "qtySold" DESC NULLS LAST, m."category"
   LIMIT 30`

const topMenuItemsSql = `
  SELECT m."itemName",
         m."category",
         COUNT(DISTINCT s.id)::int AS "storeCount",
         SUM(m."fpQuantitySold" + m."tpQuantitySold")::float8 AS "qtySold",
         SUM(m."fpTotalSales" + m."tpTotalSales")::float8 AS "sales"
    FROM "OtterMenuItem" m
    JOIN "Store" s ON s.id = m."storeId"
   WHERE s."accountId" = $1
     AND m."isModifier" = false
     AND m."date" >= CURRENT_DATE - INTERVAL '90 days'
   GROUP BY m."itemName", m."category"
   HAVING SUM(m."fpQuantitySold" + m."tpQuantitySold") > 0
   ORDER BY "qtySold" DESC
   LIMIT 40`

const recipeCategoriesSql = `
  SELECT "category",
         COUNT(*)::int AS "recipeCount",
         COUNT(*) FILTER (WHERE "isSellable")::int AS "sellableCount"
    FROM "Recipe"
   WHERE "accountId" = $1
   GROUP BY "category"
   ORDER BY "sellableCount" DESC, "category"`

const recipesSql = `
  SELECT r."itemName",
         r."category",
         r."servingSize",
         r."foodCostOverride",
         COUNT(ri.id)::int AS "ingredientCount"
    FROM "Recipe" r
    LEFT JOIN "RecipeIngredient" ri ON ri."recipeId" = r.id
   WHERE r."accountId" = $1
     AND r."isSellable" = true
   GROUP BY r.id
   ORDER BY r."category", r."itemName"
   LIMIT 80`

const ingredientsSql = `
  SELECT c."name",
         c."category",
         COALESCE(c."recipeUnit", c."defaultUnit") AS "unit",
         c."costPerRecipeUnit" AS "currentCost",
         c."costSource",
         c."costUpdatedAt"
    FROM "CanonicalIngredient" c
   WHERE c."accountId" = $1
   ORDER BY (c."costPerRecipeUnit" IS NULL), c."name"
   LIMIT 80`

const aliasesSql = `
  SELECT ia."rawName",
         ia."canonicalName",
         s."name" AS "store"
    FROM "IngredientAlias" ia
    JOIN "Store" s ON s.id = ia."storeId"
   WHERE s."accountId" = $1
   ORDER BY ia."canonicalName", ia."rawName"
   LIMIT 80`

const vendorsSql = `
  SELECT i."vendorName",
         COUNT(*)::int AS "invoiceCount",
         SUM(i."totalAmount")::float8 AS "totalSpend",
         MAX(i."invoiceDate") AS "latestInvoiceDate"
    FROM "Invoice" i
   WHERE i."accountId" = $1
   GROUP BY i."vendorName"
   ORDER BY "totalSpend" DESC NULLS LAST
   LIMIT 30`

const invoicesSql = `
  SELECT i."vendorName",
         i."invoiceNumber",
         i."invoiceDate",
         i."totalAmount",
         COALESCE(s."name", '(no store)') AS "store",
         i.id
    FROM "Invoice" i
    LEFT JOIN "Store" s ON s.id = i."storeId"
   WHERE i."accountId" = $1
   ORDER BY i."totalAmount" DESC NULLS LAST
   LIMIT 20`

const invoiceLinesSql = `
  SELECT i."vendorName",
         l."productName",
         l."unit",
         l."unitPrice",
         SUM(l."extendedPrice")::float8 AS "spend",
         COUNT(*)::int AS "lineCount",
         MAX(i."invoiceDate") AS "latestInvoiceDate"
    FROM "InvoiceLineItem" l
    JOIN "Invoice" i ON i.id = l."invoiceId"
   WHERE i."accountId" = $1
   GROUP BY i."vendorName", l."productName", l."unit", l."unitPrice"
   ORDER BY "spend" DESC NULLS LAST
   LIMIT 40`

const cogsSql = `
  SELECT d."itemName",
         d."category",
         COUNT(DISTINCT d."storeId")::int AS "storeCount",
         SUM(d."qtySold")::float8 AS "qtySold",
         SUM(d."salesRevenue")::float8 AS "revenue",
         SUM(d."lineCost")::float8 AS "totalCost",
         CASE WHEN SUM(d."salesRevenue") = 0 THEN NULL
              ELSE SUM(d."lineCost") / SUM(d."salesRevenue") * 100
          END AS "foodCostPct"
    FROM "DailyCogsItem" d
    JOIN "Store" s ON s.id = d."storeId"
   WHERE s."accountId" = $1
     AND d."date" >= CURRENT_DATE - INTERVAL '90 days'
   GROUP BY d."itemName", d."category"
   ORDER BY "revenue" DESC NULLS LAST
   LIMIT 40`

async function pickAccountId(client: pg.Client): Promise<string> {
  const explicit = process.env.CHAT_RESEARCH_ACCOUNT_ID
  if (explicit) return explicit

  const result = await client.query<{ id: string }>(`
    SELECT a.id
      FROM "Account" a
      LEFT JOIN "Store" s ON s."accountId" = a.id AND s."isActive" = true
     GROUP BY a.id
     ORDER BY COUNT(s.id) DESC, a.id
     LIMIT 1`)

  const id = result.rows[0]?.id
  if (!id) throw new Error("No account found in DATABASE_URL2")
  return id
}

async function printSection(
  client: pg.Client,
  title: string,
  sql: string,
  values: unknown[],
) {
  const result = await client.query<QueryRow>(sql, values)
  console.log(`\n## ${title}`)
  if (result.rows.length === 0) {
    console.log("(none)")
    return
  }
  console.table(result.rows.map(formatRow))
}

function formatRow(row: QueryRow): QueryRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (value instanceof Date) return [key, value.toISOString().slice(0, 10)]
      if (typeof value === "number") return [key, Math.round(value * 100) / 100]
      return [key, value]
    }),
  )
}

async function loadEnvLocal(): Promise<void> {
  try {
    const raw = await readFile(resolve(process.cwd(), ".env.local"), "utf-8")
    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (value && process.env[key] === undefined) process.env[key] = value
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "ENOENT") throw error
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
