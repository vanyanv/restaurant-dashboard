/**
 * Smoke test for the chat embedding helper. Run with:
 *   npx tsx --env-file=.env.local scripts/chat-smoke/test-embeddings.ts
 *
 * Verifies: dim count, batch shape, hash stability, pgvector roundtrip
 * (insert + cosine self-similarity ~1.0, vs unrelated text < 0.5).
 */

import { Client } from "pg"
import {
  embed,
  embedBatch,
  snapshotHash,
  toVectorLiteral,
} from "../../src/lib/chat/embeddings"

async function main() {
  console.log("--- single embed ---")
  const v = await embed("chicken thighs 40lb case")
  console.log("dims:", v.length)
  console.log("first 4:", v.slice(0, 4).map((n) => n.toFixed(4)))

  console.log("--- batch embed ---")
  const batch = await embedBatch([
    "whole milk 1 gallon",
    "san marzano tomatoes #10 can",
    "extra virgin olive oil 3L",
  ])
  console.log(
    "batch len:",
    batch.length,
    "dims:",
    batch.map((row) => row.length),
  )

  console.log("--- hash stability ---")
  const h1 = snapshotHash("Hello World")
  const h2 = snapshotHash("hello   world  ")
  console.log("h1:", h1.slice(0, 12))
  console.log("h2:", h2.slice(0, 12))
  console.log("equal under normalization?", h1 === h2)

  const url = process.env.DATABASE_URL2 ?? process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL2 (or DATABASE_URL) not set")
  const c = new Client({ connectionString: url })
  await c.connect()

  console.log("--- pgvector roundtrip ---")
  await c.query(
    `DELETE FROM "MenuItemEmbedding" WHERE "menuItemId" = 'smoke-test'`,
  )
  await c.query(
    `INSERT INTO "MenuItemEmbedding"
       (id, "menuItemId", "ownerId", "contentSnapshot", embedding, "createdAt")
     VALUES ($1, $2, $3, $4, $5::vector, NOW())`,
    [
      "smoke-test-id",
      "smoke-test",
      "smoke-test-owner",
      "chicken thighs",
      toVectorLiteral(v),
    ],
  )

  const sim = await c.query(
    `SELECT "menuItemId", 1 - (embedding <=> $1::vector) AS score
       FROM "MenuItemEmbedding" WHERE "menuItemId" = 'smoke-test'`,
    [toVectorLiteral(v)],
  )
  console.log("self-similarity (should be ~1.0):", sim.rows[0])

  const distinct = await embed("financial reports quarterly earnings")
  const sim2 = await c.query(
    `SELECT 1 - (embedding <=> $1::vector) AS score
       FROM "MenuItemEmbedding" WHERE "menuItemId" = 'smoke-test'`,
    [toVectorLiteral(distinct)],
  )
  console.log("vs unrelated text (should be lower):", sim2.rows[0])

  await c.query(
    `DELETE FROM "MenuItemEmbedding" WHERE "menuItemId" = 'smoke-test'`,
  )
  await c.end()
  console.log("ok")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
