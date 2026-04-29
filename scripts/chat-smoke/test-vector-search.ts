/**
 * Smoke test for vector search against the backfilled corpus. Runs a fixed
 * set of natural-language queries through pgvector cosine similarity and
 * prints top-5 hits with scores so we can eyeball recall before wiring up
 * the chat tools.
 *
 * Run: npx tsx --env-file=.env.local scripts/chat-smoke/test-vector-search.ts
 */

import { Client } from "pg"
import { embed, toVectorLiteral } from "../../src/lib/chat/embeddings"

const INVOICE_QUERIES = [
  "chicken thighs",
  "olive oil",
  "tomatoes",
  "cheese",
  "frozen french fries",
  "ice cream",
]

const MENU_QUERIES = [
  "vanilla ice cream",
  "chocolate shake",
  "burger",
  "extra cheese",
]

async function main() {
  const url = process.env.DATABASE_URL2 ?? process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL2 (or DATABASE_URL) not set")
  const c = new Client({ connectionString: url })
  await c.connect()

  console.log("=== INVOICE SEARCH ===")
  for (const q of INVOICE_QUERIES) {
    const vec = await embed(q)
    const res = await c.query(
      `SELECT i."vendorName", l."productName", l."category", l."unit",
              1 - (e.embedding <=> $1::vector) AS score
         FROM "InvoiceLineEmbedding" e
         JOIN "InvoiceLineItem" l ON l.id = e."invoiceLineId"
         JOIN "Invoice" i ON i.id = e."invoiceId"
        ORDER BY e.embedding <=> $1::vector
        LIMIT 5`,
      [toVectorLiteral(vec)],
    )
    console.log(`\nquery: "${q}"`)
    for (const r of res.rows) {
      console.log(
        `  ${r.score.toFixed(3)}  ${r.vendorName} · ${r.productName}${r.unit ? ` (${r.unit})` : ""}`,
      )
    }
  }

  console.log("\n=== MENU SEARCH ===")
  for (const q of MENU_QUERIES) {
    const vec = await embed(q)
    const res = await c.query(
      `SELECT e."contentSnapshot" AS hash, e."menuItemId",
              1 - (e.embedding <=> $1::vector) AS score
         FROM "MenuItemEmbedding" e
        ORDER BY e.embedding <=> $1::vector
        LIMIT 5`,
      [toVectorLiteral(vec)],
    )
    console.log(`\nquery: "${q}"`)
    for (const r of res.rows) {
      console.log(`  ${r.score.toFixed(3)}  menuItemId=${r.menuItemId}`)
    }
  }

  console.log("\n=== MENU SEARCH (with denormalized item info) ===")
  for (const q of MENU_QUERIES) {
    const vec = await embed(q)
    const res = await c.query(
      `SELECT e."itemName", e."category", s."name" AS "storeName",
              1 - (e.embedding <=> $1::vector) AS score
         FROM "MenuItemEmbedding" e
         JOIN "Store" s ON s.id = e."storeId"
        ORDER BY e.embedding <=> $1::vector
        LIMIT 5`,
      [toVectorLiteral(vec)],
    )
    console.log(`\nquery: "${q}"`)
    for (const r of res.rows) {
      console.log(
        `  ${Number(r.score).toFixed(3)}  ${r.itemName} (${r.category}) at ${r.storeName}`,
      )
    }
  }

  await c.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
